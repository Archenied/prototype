// 프로토타입 Windows 실행 파일
// 1) 숨은 창으로 로컬 서버(node server\server.mjs)를 켠다
// 2) Microsoft Edge 앱 창(--app)으로 화면을 연다 (주소창 없는 일반 프로그램 창)
// 3) 창을 닫으면 서버도 끈다
// 이미 켜져 있으면 서버는 그대로 두고 창만 앞으로 가져온다.
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
        Log(dir, "launcher start (pid " + Process.GetCurrentProcess().Id + ")");
        // 지난 업데이트 때 이름을 바꿔 둔 옛 실행 파일 정리
        try { string old = Path.Combine(dir, "Prototype.old.exe"); if (File.Exists(old)) File.Delete(old); } catch { }
        string server = Path.Combine(dir, "server", "server.mjs");
        if (!File.Exists(server))
        {
            Fail("server 폴더를 찾을 수 없어요.\n\nPrototype.exe는 prototype 폴더 안에 그대로 두고 실행해 주세요.");
            return 1;
        }

        string edge = FindEdge();
        if (edge == null)
        {
            Fail("Microsoft Edge를 찾을 수 없어요.\n\nEdge가 설치되어 있어야 앱 창을 열 수 있어요.");
            return 1;
        }

        Process node = null;
        if (!IsOurServerRunning())
        {
            node = StartServer(dir, server);
            if (node == null) return 1;
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

    static void Fail(string msg)
    {
        MessageBox.Show(msg, "프로토타입", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}
