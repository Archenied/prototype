// 프로토타입 Windows 실행 파일
// 1) 숨은 창으로 로컬 서버(node server\server.mjs)를 켠다
// 2) Microsoft Edge 앱 창(--app)으로 화면을 연다 (주소창 없는 일반 프로그램 창)
// 3) 창을 닫으면 서버도 끈다
// 이미 켜져 있으면 서버는 그대로 두고 창만 앞으로 가져온다.
// Prototype.exe 하나만 있으면(옆에 server 폴더가 없으면) GitHub에서 앱 파일을 받아
// %LOCALAPPDATA%\Prototype-TWT\app 에 설치하고 그곳의 Prototype.exe를 실행한다. 업데이트도 그곳에서 받는다.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("프로토타입")]
[assembly: System.Reflection.AssemblyProduct("프로토타입 - 시각·날씨·교통")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class Launcher
{
    const int Port = 48620;
    const string AppId = "prototype-twt";
    static readonly string Url = "http://127.0.0.1:" + Port + "/";

    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string server = Path.Combine(dir, "server", "server.mjs");
        // Prototype.exe 하나만 받아서 실행했으면 GitHub에서 앱을 받아 설치한 뒤 그쪽을 실행한다.
        if (!File.Exists(server)) return Bootstrap.Run();
        Log(dir, "launcher start (pid " + Process.GetCurrentProcess().Id + ")");
        // 지난 업데이트 때 이름을 바꿔 둔 옛 실행 파일 정리
        try { string old = Path.Combine(dir, "Prototype.old.exe"); if (File.Exists(old)) File.Delete(old); } catch { }

        // 앱 창(WebView2)을 쓸 수 있으면 Prototype.exe 자신의 창으로 연다. 이미 열려 있으면 그 창을 앞으로.
        bool ownWindow = Environment.GetEnvironmentVariable("PROTOTYPE_USE_EDGE") != "1" && WebView2Setup.Prepare() && WebView2Setup.RuntimeAvailable();
        Mutex single = null;
        if (ownWindow)
        {
            bool first;
            single = new Mutex(true, "Local\\Prototype-TWT-window", out first);
            if (!first) { ActivateExisting(); return 0; }
        }

        Process node = null;
        if (!IsOurServerRunning())
        {
            node = StartServer(dir, server);
            if (node == null) return 1;
        }

        if (ownWindow)
        {
            string err = RunOwnWindow(dir, server, ref node);
            if (err == null)
            {
                try { if (node != null && !node.HasExited) node.Kill(); } catch { }
                Log(dir, "app closed");
                GC.KeepAlive(single);
                return 0;
            }
            Log(dir, "app window failed, using Edge: " + err);
        }

        string edge = FindEdge();
        if (edge == null)
        {
            if (node != null) try { node.Kill(); } catch { }
            Fail("Microsoft Edge를 찾을 수 없어요.\n\nEdge가 설치되어 있어야 앱 창을 열 수 있어요.");
            return 1;
        }

        // 앱 전용 Edge 프로필: 설정·마지막 데이터가 여기에 저장되고, 창을 닫을 때까지 기다릴 수 있다.
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prototype-TWT", "EdgeProfile");
        Directory.CreateDirectory(profile);
        string edgeArgs = "--app=" + Url + " --user-data-dir=\"" + profile + "\" --window-size=1280,860 --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2";
        Process win;
        try
        {
            win = Process.Start(new ProcessStartInfo(edge, edgeArgs) { UseShellExecute = false });
        }
        catch (Exception ex)
        {
            if (node != null) try { node.Kill(); } catch { }
            Fail("앱 창을 열지 못했어요.\n\n" + ex.Message);
            return 1;
        }

        // 이 실행 파일이 서버를 켠 경우에만 창이 닫힐 때까지 기다렸다가 서버를 끈다.
        if (node != null)
        {
            while (true)
            {
                // 앱 창이 열려 있는 동안 기다린다. 서버가 종료 코드 42(업데이트)로 끝나면
                // 창은 그대로 두고 새 서버만 다시 켠다. 화면은 새 서버를 알아채고 스스로 새로 고친다.
                while (!node.HasExited && (!win.HasExited || EdgeWithProfileRunning(profile))) Thread.Sleep(500);
                if (node.HasExited && node.ExitCode == 42)
                {
                    Log(dir, "update: restarting server");
                    node = StartServer(dir, server);
                    if (node == null) { KillProfileEdge(profile); return 1; }
                    continue;
                }
                break;
            }
            // 같은 프로필의 Edge가 아직 남아 있으면 (창 여러 개) 모두 닫힐 때까지 기다린다.
            while (EdgeWithProfileRunning(profile)) Thread.Sleep(1500);
            try { if (!node.HasExited) node.Kill(); } catch { }
            Log(dir, "app closed");
        }
        return 0;
    }

    // 자신의 앱 창을 연다. 창이 열려 있는 동안 서버가 업데이트(종료 코드 42)로 끝나면 서버만 다시 켠다.
    // 창을 못 열면 이유를 돌려준다 (그러면 Edge 창으로 연다). 정상으로 닫히면 null.
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static string RunOwnWindow(string dir, string server, ref Process node)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var win = new AppWindow(Url);
        Process current = node;
        bool closed = false;
        if (current != null)
        {
            var watch = new Thread(() =>
            {
                while (!closed)
                {
                    Thread.Sleep(500);
                    Process n = current;
                    if (n == null || !n.HasExited || closed) continue;
                    if (n.ExitCode != 42) break; // 서버가 다른 이유로 끝남: 그대로 둔다
                    Log(dir, "update: restarting server");
                    current = StartServer(dir, server);
                }
            });
            watch.IsBackground = true;
            watch.Start();
        }
        Application.Run(win);
        closed = true;
        node = current;
        return win.Failed ? (win.Error ?? "unknown") : null;
    }

    // 이미 열린 앱 창을 앞으로 가져온다.
    static void ActivateExisting()
    {
        int me = Process.GetCurrentProcess().Id;
        foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Application.ExecutablePath)))
        {
            if (p.Id == me || p.MainWindowHandle == IntPtr.Zero) continue;
            if (IsIconic(p.MainWindowHandle)) ShowWindow(p.MainWindowHandle, 9);
            SetForegroundWindow(p.MainWindowHandle);
            return;
        }
    }
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

    // 숨은 창으로 서버를 켜고 준비될 때까지 기다린다. 실패하면 안내를 띄우고 null.
    static Process StartServer(string dir, string server)
    {
        string nodeExe = FindNode(dir);
        if (nodeExe == null)
        {
            Fail("Node.js를 찾을 수 없어요.\n\nhttps://nodejs.org 에서 Node.js(LTS)를 설치한 뒤 다시 실행해 주세요.");
            return null;
        }
        var psi = new ProcessStartInfo(nodeExe, "\"" + server + "\" --port " + Port)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = dir,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        psi.EnvironmentVariables["PROTO_LAUNCHER"] = "1";
        Process node;
        try { node = Process.Start(psi); }
        catch (Exception ex)
        {
            Fail("서버를 시작하지 못했어요.\n\n" + ex.Message);
            return null;
        }
        bool ready = false;
        for (int i = 0; i < 80 && !ready; i++)
        {
            if (node.HasExited) break;
            Thread.Sleep(150);
            ready = IsOurServerRunning();
        }
        if (!ready)
        {
            string why = node.HasExited && node.ExitCode == 3
                ? "48620번 포트를 다른 프로그램이 쓰고 있어요."
                : "data\\server.log 파일에서 자세한 내용을 볼 수 있어요.";
            try { if (!node.HasExited) node.Kill(); } catch { }
            Fail("서버가 준비되지 않았어요.\n\n" + why);
            return null;
        }
        return node;
    }

    static bool IsOurServerRunning()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Url + "api/health");
            req.Timeout = 800;
            req.Proxy = null;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(res.GetResponseStream()))
                return sr.ReadToEnd().Contains("\"" + AppId + "\"");
        }
        catch { return false; }
    }

    static bool EdgeWithProfileRunning(string profile)
    {
        // 프로필 폴더의 잠금 파일이 있으면 그 프로필로 Edge가 실행 중이다.
        try
        {
            string lockFile = Path.Combine(profile, "lockfile");
            if (!File.Exists(lockFile)) return false;
            using (File.Open(lockFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            return false;
        }
        catch (IOException) { return true; }
        catch { return false; }
    }

    static string FindNode(string dir)
    {
        string local = Path.Combine(dir, "node", "node.exe");
        if (File.Exists(local)) return local;
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string std = Path.Combine(pf, "nodejs", "node.exe");
        if (File.Exists(std)) return std;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string p in path.Split(';'))
        {
            try
            {
                string c = Path.Combine(p.Trim().Trim('"'), "node.exe");
                if (File.Exists(c)) return c;
            }
            catch { }
        }
        return null;
    }

    static string FindEdge()
    {
        string[] cands = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        foreach (string c in cands) if (File.Exists(c)) return c;
        return null;
    }

    // 앱 전용 프로필(--user-data-dir)로 실행 중인 Edge 프로세스를 모두 끝낸다.
    static void KillProfileEdge(string profile)
    {
        try
        {
            using (var s = new System.Management.ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'"))
                foreach (System.Management.ManagementObject o in s.Get())
                {
                    string cmd = (o["CommandLine"] as string) ?? "";
                    if (cmd.IndexOf(profile, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    try { Process.GetProcessById(Convert.ToInt32(o["ProcessId"])).Kill(); } catch { }
                }
        }
        catch { }
    }

    static void Log(string dir, string msg)
    {
        try
        {
            string d = Path.Combine(dir, "data");
            Directory.CreateDirectory(d);
            File.AppendAllText(Path.Combine(d, "launcher.log"), DateTime.Now.ToString("s") + " " + msg + Environment.NewLine);
        }
        catch { }
    }

    internal static void Fail(string msg)
    {
        MessageBox.Show(msg, "프로토타입", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}

// Prototype.exe 하나만 있을 때: GitHub에서 앱을 받아 설치하고 실행한다.
static class Bootstrap
{
    const string ZipUrl = "https://github.com/Archenied/prototype/archive/refs/heads/main.zip";
    static readonly bool Silent = Environment.GetEnvironmentVariable("PROTOTYPE_SILENT_INSTALL") == "1"; // 시험용: 창 없이 설치만
    static string AppDir
    {
        get
        {
            string test = Environment.GetEnvironmentVariable("PROTOTYPE_APP_DIR"); // 시험용 설치 위치
            if (!string.IsNullOrEmpty(test)) return test;
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prototype-TWT", "app");
        }
    }

    public static int Run()
    {
        string appExe = Path.Combine(AppDir, "Prototype.exe");
        if (!File.Exists(Path.Combine(AppDir, "server", "server.mjs")) || !File.Exists(appExe))
        {
            if (!Install()) return 1;
            if (Silent) return 0;
            MakeShortcuts(appExe);
        }
        try
        {
            Process.Start(new ProcessStartInfo(appExe) { WorkingDirectory = AppDir, UseShellExecute = false });
            return 0;
        }
        catch (Exception ex)
        {
            Launcher.Fail("앱을 실행하지 못했어요.\n\n" + ex.Message);
            return 1;
        }
    }

    // 작은 창에 '받는 중'을 보여 주면서 GitHub ZIP을 받아 푼다.
    static bool Install()
    {
        if (Silent)
        {
            try { Download(); return true; } catch (Exception ex) { Console.Error.WriteLine(ex); return false; }
        }
        Exception error = null;
        Application.EnableVisualStyles();
        var form = new Form
        {
            Text = "프로토타입 설치",
            ClientSize = new System.Drawing.Size(420, 96),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterScreen,
            MaximizeBox = false,
            MinimizeBox = false,
        };
        try { form.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        form.Controls.Add(new Label { Text = "처음 실행이라 GitHub에서 앱을 받고 있어요…", Left = 20, Top = 20, Width = 380, Height = 22 });
        form.Controls.Add(new ProgressBar { Left = 20, Top = 52, Width = 380, Height = 18, Style = ProgressBarStyle.Marquee });
        form.Shown += delegate
        {
            var t = new Thread(() =>
            {
                try { Download(); }
                catch (Exception ex) { error = ex; }
                try { form.BeginInvoke((MethodInvoker)form.Close); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        };
        Application.Run(form);
        if (error != null)
        {
            Launcher.Fail("GitHub에서 앱을 받지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.\n\n" + error.Message);
            return false;
        }
        return true;
    }

    static void Download()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        string root = Path.GetDirectoryName(AppDir);
        Directory.CreateDirectory(root);
        string zip = Path.Combine(root, "download.zip");
        string tmp = Path.Combine(root, "download-tmp");
        using (var wc = new WebClient())
        {
            wc.Headers[HttpRequestHeader.UserAgent] = "Prototype-Launcher";
            wc.DownloadFile(ZipUrl, zip);
        }
        if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
        System.IO.Compression.ZipFile.ExtractToDirectory(zip, tmp);
        // ZIP 안의 'prototype-main' 폴더 내용을 app 폴더로 옮긴다. (이미 있던 API_KEYS.bat·data는 그대로)
        string top = Directory.GetDirectories(tmp)[0];
        Directory.CreateDirectory(AppDir);
        foreach (string f in Directory.GetFiles(top, "*", SearchOption.AllDirectories))
        {
            string rel = f.Substring(top.Length + 1);
            string dest = Path.Combine(AppDir, rel);
            if (rel.Equals("API_KEYS.bat", StringComparison.OrdinalIgnoreCase) && File.Exists(dest)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            File.Copy(f, dest, true);
        }
        try { Directory.Delete(tmp, true); File.Delete(zip); } catch { }
        if (!File.Exists(Path.Combine(AppDir, "server", "server.mjs"))) throw new Exception("받은 파일에 server 폴더가 없어요.");
    }

    // 바탕화면·시작 메뉴에 '프로토타입' 바로 가기 (설치된 앱을 바로 연다)
    static void MakeShortcuts(string target)
    {
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            foreach (string folder in new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs") })
            {
                object lnk = t.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(folder, "프로토타입.lnk") });
                Type lt = lnk.GetType();
                lt.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, lnk, new object[] { target });
                lt.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, lnk, new object[] { Path.GetDirectoryName(target) });
                lt.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, lnk, new object[] { "프로토타입 - 시각·날씨·교통" });
                lt.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, lnk, null);
            }
        }
        catch { }
    }
}
