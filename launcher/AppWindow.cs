// 프로토타입 앱 창 (Edge 창이 아니라 Prototype.exe 자신의 창)
// 창 안의 화면은 Windows에 들어 있는 WebView2(웹 엔진)로 그린다. Android 앱이 Android WebView를 쓰는 것과 같다.
// 그래서 작업 표시줄에 고정해도 Edge가 아니라 Prototype.exe가 고정된다.
// WebView2 SDK 파일(launcher\webview2\)은 exe 안에 넣어 두고, 처음 실행할 때 %LOCALAPPDATA%\Prototype-TWT\bin 에 꺼낸다.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class WebView2Setup
{
    public const string SdkVersion = "1.0.2903.40";
    static string binDir;

    public static string Root
    {
        get
        {
            string test = Environment.GetEnvironmentVariable("PROTOTYPE_DATA_ROOT"); // 시험용
            return string.IsNullOrEmpty(test) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prototype-TWT") : test;
        }
    }

    // SDK 파일을 꺼내고, .NET이 그 파일을 찾을 수 있게 한다. (WebView2 형식을 쓰기 전에 불러야 함)
    public static bool Prepare()
    {
        try
        {
            binDir = Path.Combine(Root, "bin", SdkVersion);
            Directory.CreateDirectory(binDir);
            string arch = Environment.Is64BitProcess
                ? (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") == "ARM64" ? "arm64" : "x64")
                : "x86";
            Extract("wv2.Core.dll", "Microsoft.Web.WebView2.Core.dll");
            Extract("wv2.WinForms.dll", "Microsoft.Web.WebView2.WinForms.dll");
            Extract("wv2.loader." + arch + ".dll", "WebView2Loader.dll");
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                string name = new AssemblyName(e.Name).Name;
                string f = Path.Combine(binDir, name + ".dll");
                return name.StartsWith("Microsoft.Web.WebView2") && File.Exists(f) ? Assembly.LoadFrom(f) : null;
            };
            return true;
        }
        catch { return false; }
    }

    static void Extract(string resource, string file)
    {
        string dest = Path.Combine(binDir, file);
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
        {
            if (s == null) throw new FileNotFoundException(resource);
            if (File.Exists(dest) && new FileInfo(dest).Length == s.Length) return;
            using (var f = File.Create(dest)) s.CopyTo(f);
        }
    }

    // 이 PC에 WebView2 런타임이 있는지 (Windows 11과 대부분의 Windows 10에는 기본으로 있음)
    public static bool RuntimeAvailable()
    {
        try
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(binDir);
            return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch { return false; }
    }
}

class AppWindow : Form
{
    readonly string url;
    readonly string dataDir;
    readonly WebView2 web = new WebView2();
    NotifyIcon tray;
    public bool Failed;
    public string Error;

    public AppWindow(string url)
    {
        this.url = url;
        dataDir = Path.Combine(WebView2Setup.Root, "WebView2");
        Text = "프로토타입";
        try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new System.Drawing.Size(1280, 860);
        MinimumSize = new System.Drawing.Size(380, 560);
        BackColor = System.Drawing.Color.FromArgb(0xf4, 0xf6, 0xfb);
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
        RestoreBounds_();
        Shown += async (s, e) => await Init();
        FormClosing += (s, e) => SaveBounds();
    }

    async Task Init()
    {
        try
        {
            MigrateEdgeProfile(dataDir);
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false; // Ctrl+P·Ctrl+F 같은 브라우저 단축키 끄기
            core.Settings.IsZoomControlEnabled = false;
            core.DocumentTitleChanged += (s, e) => { Text = string.IsNullOrEmpty(core.DocumentTitle) ? "프로토타입" : core.DocumentTitle; };
            // 다른 사이트(데이터 출처, GitHub 등)는 기본 브라우저로 연다
            core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.NavigationStarting += (s, e) =>
            {
                if (!e.Uri.StartsWith(url, StringComparison.OrdinalIgnoreCase)) { e.Cancel = true; OpenExternal(e.Uri); }
            };
            // 위치·알림 권한은 앱 화면이 스스로 물어보므로, 이 앱 주소에 한해 허용
            core.PermissionRequested += (s, e) =>
            {
                if (e.Uri.StartsWith(url, StringComparison.OrdinalIgnoreCase) &&
                    (e.PermissionKind == CoreWebView2PermissionKind.Notifications || e.PermissionKind == CoreWebView2PermissionKind.Geolocation))
                    e.State = CoreWebView2PermissionState.Allow;
            };
            // 출발 알림 → Windows 알림
            core.NotificationReceived += (s, e) =>
            {
                e.Handled = true;
                var n = e.Notification;
                ShowNotice(n.Title, n.Body);
                try { n.ReportShown(); } catch { }
            };
            // 시험용: 화면이 다 뜨면 스크린샷을 저장하고 닫는다 (PROTOTYPE_SHOT=파일 경로)
            string shot = Environment.GetEnvironmentVariable("PROTOTYPE_SHOT");
            if (!string.IsNullOrEmpty(shot))
            {
                core.NavigationCompleted += async (s, e) =>
                {
                    await Task.Delay(4000);
                    using (var f = File.Create(shot)) await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, f);
                    string info = await core.ExecuteScriptAsync("JSON.stringify({title:document.title, href:location.href, text:document.body.innerText.slice(0,300)})");
                    File.WriteAllText(shot + ".txt", info);
                    Close();
                };
            }
            web.Source = new Uri(url);
        }
        catch (Exception ex)
        {
            Failed = true;
            Error = ex.Message;
            Close();
        }
    }

    void ShowNotice(string title, string body)
    {
        if (tray == null)
        {
            tray = new NotifyIcon { Icon = Icon, Text = "프로토타입", Visible = true };
            tray.BalloonTipClicked += (s, e) => BringToFront_();
            tray.Click += (s, e) => BringToFront_();
        }
        tray.ShowBalloonTip(10000, string.IsNullOrEmpty(title) ? "프로토타입" : title, string.IsNullOrEmpty(body) ? " " : body, ToolTipIcon.None);
    }

    public void BringToFront_()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    static void OpenExternal(string u)
    {
        if (string.IsNullOrEmpty(u) || !(u.StartsWith("https://") || u.StartsWith("http://"))) return;
        try { Process.Start(new ProcessStartInfo(u) { UseShellExecute = true }); } catch { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && tray != null) { tray.Visible = false; tray.Dispose(); }
        base.Dispose(disposing);
    }

    /* 창 크기·위치 기억 */
    string BoundsFile { get { return Path.Combine(WebView2Setup.Root, "window.txt"); } }
    void RestoreBounds_()
    {
        try
        {
            string[] p = File.ReadAllText(BoundsFile).Split(',');
            var r = new System.Drawing.Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            foreach (Screen sc in Screen.AllScreens)
                if (sc.WorkingArea.IntersectsWith(r)) { StartPosition = FormStartPosition.Manual; Bounds = r; break; }
            if (p.Length > 4 && p[4] == "max") WindowState = FormWindowState.Maximized;
        }
        catch { }
    }
    void SaveBounds()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(BoundsFile, r.X + "," + r.Y + "," + r.Width + "," + r.Height + (WindowState == FormWindowState.Maximized ? ",max" : ""));
        }
        catch { }
    }

    // 예전 Edge 앱 창 프로필에 저장된 설정(지역·교통 대상·알림 등, localStorage)을 처음 한 번 옮겨 온다.
    static void MigrateEdgeProfile(string dataDir)
    {
        try
        {
            string src = Path.Combine(WebView2Setup.Root, "EdgeProfile", "Default", "Local Storage");
            string dst = Path.Combine(dataDir, "EBWebView", "Default", "Local Storage");
            if (!Directory.Exists(src) || Directory.Exists(dst)) return;
            foreach (string f in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                if (Path.GetFileName(f) == "LOCK") continue;
                string d = Path.Combine(dst, f.Substring(src.Length + 1));
                Directory.CreateDirectory(Path.GetDirectoryName(d));
                File.Copy(f, d, true);
            }
        }
        catch { }
    }
}
