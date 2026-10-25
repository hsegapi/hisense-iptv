package com.hisense.iptv;

import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "HisenseIPTV";
    private WebView webView;
    private FrameLayout customViewContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private View customView;
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep TV screen awake during playback
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        // Immersive sticky fullscreen for TV
        enableImmersiveMode();

        // Main layout container
        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.parseColor("#0b0f19"));
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // Setup WebView
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0f19"));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        customViewContainer = new FrameLayout(this);
        customViewContainer.setVisibility(View.GONE);
        customViewContainer.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        rootLayout.addView(webView);
        rootLayout.addView(customViewContainer);
        setContentView(rootLayout);

        setupWebView();
    }

    private void enableImmersiveMode() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveMode();
        }
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setUserAgentString("Mozilla/5.0 (Linux; Android 14; BRAVIA 4K Build/UR3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        // Assets loader for secure HTTPS local asset serving
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain("appassets.androidplatform.net")
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String url = uri.toString();

                // 1. Local Assets Handler
                if (url.startsWith("https://appassets.androidplatform.net/")) {
                    // API playlist endpoint mapping to local json
                    if (url.contains("/api/playlist")) {
                        try {
                            InputStream is = getAssets().open("web/playlist.json");
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Access-Control-Allow-Origin", "*");
                            headers.put("Content-Type", "application/json; charset=utf-8");
                            return new WebResourceResponse("application/json", "UTF-8", 200, "OK", headers, is);
                        } catch (Exception e) {
                            Log.e(TAG, "Failed loading bundled playlist: " + e.getMessage());
                        }
                    }

                    // API refresh endpoint response
                    if (url.contains("/api/refresh")) {
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        headers.put("Content-Type", "application/json; charset=utf-8");
                        return new WebResourceResponse("application/json", "UTF-8", 200, "OK", headers,
                                new ByteArrayInputStream("{\"status\":\"ok\",\"channels\":12667}".getBytes(StandardCharsets.UTF_8)));
                    }

                    WebResourceResponse response = assetLoader.shouldInterceptRequest(uri);
                    if (response != null) {
                        Map<String, String> headers = response.getResponseHeaders();
                        if (headers == null) {
                            headers = new HashMap<>();
                        }
                        headers.put("Access-Control-Allow-Origin", "*");
                        response.setResponseHeaders(headers);
                        return response;
                    }
                }

                // 2. Stream CORS bypass for HLS (.m3u8, .ts, .m4s)
                if (request.getMethod().equalsIgnoreCase("GET") &&
                        (url.contains(".m3u8") || url.contains(".ts") || url.contains(".m4s"))) {
                    try {
                        URL targetUrl = new URL(url);
                        HttpURLConnection conn = (HttpURLConnection) targetUrl.openConnection();
                        conn.setRequestMethod("GET");
                        conn.setConnectTimeout(8000);
                        conn.setReadTimeout(10000);
                        conn.setInstanceFollowRedirects(true);
                        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

                        // Forward request headers except host
                        Map<String, String> reqHeaders = request.getRequestHeaders();
                        if (reqHeaders != null) {
                            for (Map.Entry<String, String> h : reqHeaders.entrySet()) {
                                if (!h.getKey().equalsIgnoreCase("Host") && !h.getKey().equalsIgnoreCase("User-Agent")) {
                                    conn.setRequestProperty(h.getKey(), h.getValue());
                                }
                            }
                        }

                        int code = conn.getResponseCode();
                        if (code >= 200 && code < 400) {
                            String contentType = conn.getContentType();
                            String mimeType = "video/mp2t";
                            String encoding = "UTF-8";
                            if (contentType != null) {
                                String[] parts = contentType.split(";");
                                mimeType = parts[0].trim();
                            } else if (url.contains(".m3u8")) {
                                mimeType = "application/vnd.apple.mpegurl";
                            }

                            Map<String, String> respHeaders = new HashMap<>();
                            respHeaders.put("Access-Control-Allow-Origin", "*");
                            respHeaders.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                            respHeaders.put("Access-Control-Allow-Headers", "*");

                            return new WebResourceResponse(mimeType, encoding, code, conn.getResponseMessage(), respHeaders, conn.getInputStream());
                        }
                    } catch (Exception e) {
                        Log.d(TAG, "Stream proxy fallback for: " + url);
                    }
                }

                return super.shouldInterceptRequest(view, request);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.d("IPTV_WEB", "[" + msg.messageLevel() + "] " + msg.message() + " (" + msg.sourceId() + ":" + msg.lineNumber() + ")");
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                customViewContainer.addView(view);
                customViewContainer.setVisibility(View.VISIBLE);
                enableImmersiveMode();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                customViewContainer.removeView(customView);
                customView = null;
                customViewContainer.setVisibility(View.GONE);
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                }
                webView.setVisibility(View.VISIBLE);
                enableImmersiveMode();
            }
        });

        // Load the TV Player web app
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();

            // Handle Back key
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                handleBackPress();
                return true;
            }

            // TV Remote: Channel UP (Next Channel directly without opening menu)
            if (keyCode == KeyEvent.KEYCODE_CHANNEL_UP ||
                    keyCode == KeyEvent.KEYCODE_PAGE_UP ||
                    keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
                    keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
                webView.evaluateJavascript("if (window.playNextChannel) window.playNextChannel();", null);
                return true;
            }

            // TV Remote: Channel DOWN (Previous Channel directly without opening menu)
            if (keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN ||
                    keyCode == KeyEvent.KEYCODE_PAGE_DOWN ||
                    keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS ||
                    keyCode == KeyEvent.KEYCODE_MEDIA_REWIND) {
                webView.evaluateJavascript("if (window.playPrevChannel) window.playPrevChannel();", null);
                return true;
            }

            // TV Remote: Media Play / Pause
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                    keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
                    keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                webView.evaluateJavascript("var v = document.getElementById('videoPlayer'); if (v) { if (v.paused) v.play(); else v.pause(); }", null);
                return true;
            }

            // TV Remote: Favorite Toggle (Yellow button, Star key, or Y button)
            if (keyCode == KeyEvent.KEYCODE_PROG_YELLOW ||
                    keyCode == KeyEvent.KEYCODE_STAR ||
                    keyCode == KeyEvent.KEYCODE_BUTTON_Y) {
                webView.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown', {'key': 'f'}));", null);
                return true;
            }

            // Numeric keys 0-9 for channel jumps
            if (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9) {
                int digit = keyCode - KeyEvent.KEYCODE_0;
                webView.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown', {'key': '" + digit + "'}));", null);
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void handleBackPress() {
        if (customView != null) {
            WebChromeClient chromeClient = new WebChromeClient();
            onHideCustomView();
            return;
        }

        webView.evaluateJavascript("(function() { " +
                "var search = document.getElementById('channelSearch'); " +
                "if (search && search.value) { " +
                "  window.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Escape'})); return 'cleared_search'; " +
                "} " +
                "var osd = document.getElementById('osdContainer'); " +
                "if (osd && osd.classList.contains('visible')) { " +
                "  osd.classList.remove('visible'); return 'closed_osd'; " +
                "} else if (osd) { " +
                "  osd.classList.add('visible'); return 'opened_osd'; " +
                "} " +
                "return 'none'; " +
                "})()", value -> {
            if (value != null && (value.contains("closed_osd") || value.contains("cleared_search"))) {
                return;
            }

            long now = System.currentTimeMillis();
            if (now - lastBackPressTime < 2500) {
                finish();
            } else {
                lastBackPressTime = now;
                Toast.makeText(this, "Press BACK again to exit", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void onHideCustomView() {
        if (customView == null) return;
        customViewContainer.removeView(customView);
        customView = null;
        customViewContainer.setVisibility(View.GONE);
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
        }
        webView.setVisibility(View.VISIBLE);
        enableImmersiveMode();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
        enableImmersiveMode();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
