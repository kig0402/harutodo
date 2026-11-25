# Keep WebView JS interface
-keepclassmembers class com.harutodo.app.MainActivity$HaruNativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
