// 프로토타입 Android 앱
// - 화면(web/)은 앱 안(assets/www)에 들어 있다. 인터넷 웹 페이지를 여는 게 아니다.
//   https://appassets.androidplatform.net/ 주소로 열어서(실제로는 앱 안 파일) 일반 웹과 똑같이 동작한다.
// - 서울 버스·지하철 API(http만 있음)는 앱이 대신 받아서 화면에 넘겨 준다 (/__proxy/http/...).
// - 인터넷 표준 시각(NTP)을 재서 기기 시계와의 차이를 화면에 알려 준다 (PrototypeNative.timeJson).
// - GitHub Releases에 새 버전이 있으면 받아서 설치 화면을 연다 (PrototypeNative.updateJson / installUpdate).
package io.github.archenied.prototype;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final String RELEASES_API = "https://api.github.com/repos/Archenied/prototype/releases/latest";
    static final String[] PROXY_HOSTS = { "ws.bus.go.kr", "swopenapi.seoul.go.kr" };
    static final String[] NTP_SERVERS = { "time.google.com", "time.cloudflare.com", "pool.ntp.org", "time.windows.com" };

    WebView web;
    GeolocationPermissions.Callback geoCallback;
    String geoOrigin;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Clock.refresh();
        Updater.check(this);

        web = new WebView(this);
        web.setFitsSystemWindows(true);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " PrototypeApp/" + Updater.currentVersion(this));
        if (Build.VERSION.SDK_INT >= 29) {
            // 앱의 '화면 모드'는 화면(web)이 스스로 정한다
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        web.addJavascriptInterface(new Bridge(), "PrototypeNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    geoCallback = callback;
                    geoOrigin = origin;
                    requestPermissions(new String[] { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }, 1);
                }
            }
        });

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(ORIGIN + "/index.html");
    }

    boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == 1 && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocationPermission(), false);
            geoCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Clock.refresh();
        Updater.check(this);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* ───────────── 앱 안 파일 + http 대신 받기 ───────────── */
    class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            // 다른 사이트(데이터 출처, GitHub 등)는 휴대폰 브라우저로 연다
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath() == null ? "/" : u.getPath();
            if (path.startsWith("/__proxy/http/")) return proxy(req, path.substring("/__proxy/http/".length()), u.getEncodedQuery());
            return asset(path);
        }
    }

    WebResourceResponse asset(String path) {
        if (path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return status(403, "Forbidden");
        try {
            InputStream in = getAssets().open("www" + path);
            WebResourceResponse r = new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".json") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return status(404, "Not Found");
        }
    }

    static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    static WebResourceResponse status(int code, String reason) {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(code, reason);
        return r;
    }

    // 서울시 API(http)만 대신 받는다. 다른 주소는 거절.
    WebResourceResponse proxy(WebResourceRequest req, String hostAndPath, String query) {
        int slash = hostAndPath.indexOf('/');
        String host = slash < 0 ? hostAndPath : hostAndPath.substring(0, slash);
        boolean allowed = false;
        for (String h : PROXY_HOSTS) if (h.equalsIgnoreCase(host)) allowed = true;
        if (!allowed || !"GET".equalsIgnoreCase(req.getMethod())) return status(403, "Forbidden");
        HttpURLConnection c = null;
        try {
            String target = "http://" + hostAndPath + (query != null ? "?" + query : "");
            c = (HttpURLConnection) new URL(target).openConnection();
            c.setConnectTimeout(7000);
            c.setReadTimeout(7000);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] body = in == null ? new byte[0] : readAll(in);
            String type = c.getContentType() == null ? "text/plain" : c.getContentType();
            String mimeType = type.split(";")[0].trim();
            String charset = type.toLowerCase().contains("charset=") ? type.substring(type.toLowerCase().indexOf("charset=") + 8).trim() : "utf-8";
            WebResourceResponse r = new WebResourceResponse(mimeType, charset, new ByteArrayInputStream(body));
            String reason = c.getResponseMessage();
            r.setStatusCodeAndReasonPhrase(code, reason == null || reason.isEmpty() ? "OK" : reason);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            r.setResponseHeaders(h);
            return r;
        } catch (Exception e) {
            return status(502, "Bad Gateway");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    /* ───────────── 화면(JavaScript)에서 부르는 함수 ───────────── */
    class Bridge {
        @JavascriptInterface
        public String version() { return Updater.currentVersion(MainActivity.this); }

        @JavascriptInterface
        public String timeJson() { return Clock.json(); }

        @JavascriptInterface
        public String updateJson() {
            Updater.check(MainActivity.this);
            return Updater.json(MainActivity.this);
        }

        @JavascriptInterface
        public String installUpdate() {
            runOnUiThread(() -> Updater.install(MainActivity.this));
            return "{\"ok\":true}";
        }
    }

    /* ───────────── 인터넷 표준 시각 (NTP) ───────────── */
    static class Clock {
        static volatile long offset = 0;      // 표준 시각 - 기기 시각 (ms)
        static volatile long rtt = 0;
        static volatile String host = null;
        static volatile long measuredAt = 0;  // 잰 때 (기기 시각)
        static volatile boolean running = false;
        static volatile boolean failed = false;

        static void refresh() {
            if (running || (measuredAt != 0 && System.currentTimeMillis() - measuredAt < 120_000)) return;
            running = true;
            new Thread(() -> {
                long bestRtt = Long.MAX_VALUE, bestOffset = 0;
                String bestHost = null;
                for (String server : NTP_SERVERS) {
                    try {
                        long[] r = query(server);
                        if (r[1] < bestRtt) { bestRtt = r[1]; bestOffset = r[0]; bestHost = server; }
                    } catch (Exception ignored) { }
                }
                if (bestHost != null) {
                    offset = bestOffset; rtt = bestRtt; host = bestHost;
                    measuredAt = System.currentTimeMillis();
                    failed = false;
                } else {
                    failed = true;
                }
                running = false;
            }).start();
        }

        // 결과: { offset, rtt } (ms)
        static long[] query(String server) throws Exception {
            try (DatagramSocket sock = new DatagramSocket()) {
                sock.setSoTimeout(2000);
                byte[] buf = new byte[48];
                buf[0] = 0x23; // 버전 4, 클라이언트 모드
                InetAddress addr = InetAddress.getByName(server);
                long t0 = System.currentTimeMillis();
                sock.send(new DatagramPacket(buf, buf.length, addr, 123));
                DatagramPacket reply = new DatagramPacket(new byte[48], 48);
                sock.receive(reply);
                long t3 = System.currentTimeMillis();
                byte[] b = reply.getData();
                if ((b[0] & 0x07) != 4 || b[1] == 0) throw new Exception("bad reply");
                double t1 = ntpTime(b, 32), t2 = ntpTime(b, 40);
                long off = Math.round(((t1 - t0) + (t2 - t3)) / 2);
                long rt = Math.round((t3 - t0) - (t2 - t1));
                return new long[] { off, Math.max(0, rt) };
            }
        }

        static double ntpTime(byte[] b, int at) {
            long sec = ((b[at] & 0xffL) << 24) | ((b[at + 1] & 0xffL) << 16) | ((b[at + 2] & 0xffL) << 8) | (b[at + 3] & 0xffL);
            long frac = ((b[at + 4] & 0xffL) << 24) | ((b[at + 5] & 0xffL) << 16) | ((b[at + 6] & 0xffL) << 8) | (b[at + 7] & 0xffL);
            return (sec - 2208988800L) * 1000.0 + frac * 1000.0 / 4294967296.0;
        }

        static String json() {
            refresh();
            try {
                JSONObject j = new JSONObject();
                if (measuredAt == 0) {
                    if (running && !failed) j.put("pending", true);
                    j.put("trueNow", System.currentTimeMillis());
                    j.put("source", "device");
                    j.put("precisionMs", 1e9);
                } else {
                    j.put("trueNow", System.currentTimeMillis() + offset);
                    j.put("source", "ntp:" + host);
                    j.put("precisionMs", Math.max(20, rtt / 2));
                }
                return j.toString();
            } catch (Exception e) {
                return "{}";
            }
        }
    }

    /* ───────────── GitHub에서 새 버전 받기 ───────────── */
    static class Updater {
        static volatile long checkedAt = 0;
        static volatile boolean checking = false;
        static volatile String latest = null;     // 예: 1.3.0
        static volatile String apkUrl = null;
        static volatile String notes = null;      // JSON 배열 문자열
        static volatile boolean downloading = false;

        static String currentVersion(Activity a) {
            try { return a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName; } catch (Exception e) { return "0.0.0"; }
        }

        static void check(Activity a) {
            if (checking || System.currentTimeMillis() - checkedAt < 30 * 60_000) return;
            checking = true;
            new Thread(() -> {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(RELEASES_API).openConnection();
                    c.setRequestProperty("Accept", "application/vnd.github+json");
                    c.setRequestProperty("User-Agent", "Prototype-Android");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    if (c.getResponseCode() == 200) {
                        JSONObject j = new JSONObject(new String(readAll(c.getInputStream()), StandardCharsets.UTF_8));
                        String tag = j.optString("tag_name", "").replaceFirst("^v", "");
                        JSONArray assets = j.optJSONArray("assets");
                        String url = null;
                        if (assets != null) for (int i = 0; i < assets.length(); i++) {
                            JSONObject as = assets.getJSONObject(i);
                            if (as.optString("name").endsWith(".apk")) url = as.optString("browser_download_url");
                        }
                        // 릴리스 설명의 "- " 줄을 바뀐 점으로 보여 준다
                        JSONArray n = new JSONArray();
                        for (String line : j.optString("body", "").split("\n")) {
                            line = line.trim();
                            if (line.startsWith("- ")) n.put(line.substring(2).trim());
                        }
                        latest = tag; apkUrl = url; notes = n.toString();
                        checkedAt = System.currentTimeMillis();
                    } else {
                        checkedAt = System.currentTimeMillis() - 25 * 60_000; // 5분 뒤 다시
                    }
                } catch (Exception e) {
                    checkedAt = System.currentTimeMillis() - 25 * 60_000;
                } finally {
                    if (c != null) c.disconnect();
                    checking = false;
                }
            }).start();
        }

        static int compare(String a, String b) {
            String[] x = a.split("\\."), y = b.split("\\.");
            for (int i = 0; i < Math.max(x.length, y.length); i++) {
                int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
                if (p != q) return Integer.compare(p, q);
            }
            return 0;
        }

        static int parse(String s) { try { return Integer.parseInt(s.replaceAll("\\D.*", "")); } catch (Exception e) { return 0; } }

        static String json(Activity a) {
            try {
                JSONObject j = new JSONObject();
                String cur = currentVersion(a);
                boolean available = latest != null && apkUrl != null && compare(latest, cur) > 0;
                j.put("native", true);
                j.put("available", available);
                j.put("current", cur);
                if (available) {
                    j.put("next", latest);
                    j.put("notes", new JSONArray(notes == null ? "[]" : notes));
                }
                return j.toString();
            } catch (Exception e) {
                return "{\"available\":false}";
            }
        }

        static void install(Activity a) {
            if (apkUrl == null || downloading) return;
            // Android 8 이상: '이 앱에서 설치 허용'을 먼저 켜야 한다
            if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
                Toast.makeText(a, "'이 출처 허용'을 켠 뒤 다시 '업데이트'를 눌러 주세요.", Toast.LENGTH_LONG).show();
                a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
                return;
            }
            downloading = true;
            Toast.makeText(a, "새 버전을 받는 중이에요…", Toast.LENGTH_SHORT).show();
            final String url = apkUrl;
            new Thread(() -> {
                File dir = new File(a.getCacheDir(), "updates");
                File apk = new File(dir, "Prototype.apk");
                try {
                    dir.mkdirs();
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setInstanceFollowRedirects(true);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    // GitHub 다운로드는 다른 주소로 넘겨 주는데 https→https라 자동으로 따라간다
                    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    }
                    c.disconnect();
                    a.runOnUiThread(() -> {
                        Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".files", apk);
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        a.startActivity(i);
                    });
                } catch (Exception e) {
                    a.runOnUiThread(() -> Toast.makeText(a, "새 버전을 받지 못했어요. 인터넷 연결을 확인해 주세요.", Toast.LENGTH_LONG).show());
                } finally {
                    downloading = false;
                }
            }).start();
        }
    }
}
