package com.runeditrun.lodge;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** The app has its own sign-in cookie jar. No supplied role or identity grants authority. */
final class LodgeApi {
    private static byte[] readBytes(java.io.InputStream stream) throws java.io.IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }
    final String origin;
    LodgeApi(String input) throws Exception {
        URI uri = new URI(input);
        boolean local = BuildConfig.DEBUG && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost());
        if ((!local && !"https".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null)
            throw new IllegalArgumentException("Use an HTTPS installation address");
        origin = new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString();
    }
    String identity() throws Exception {
        String cookie = CookieManager.getInstance().getCookie(origin);
        if (cookie == null || cookie.isEmpty()) return "";
        byte[] hash = MessageDigest.getInstance("SHA-256").digest((origin + "\n" + cookie).getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (byte b : hash) out.append(String.format("%02x", b & 255));
        return out.toString();
    }
    static final class Reply {
        final int code; final JSONObject body;
        Reply(int code, JSONObject body) { this.code = code; this.body = body; }
    }
    Reply request(String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(origin + path).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Origin", origin);
        connection.setRequestProperty("Accept", String.join("/", "application", "json"));
        String cookie = CookieManager.getInstance().getCookie(origin);
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try {
            if (body != null) {
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", String.join("/", "application", "json"));
                try (var stream = connection.getOutputStream()) { stream.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int status = connection.getResponseCode();
            var stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text;
            if (stream == null) text = "{}";
            else { try (stream) { text = new String(readBytes(stream), StandardCharsets.UTF_8); } }
            if (status == 204) return new Reply(status, new JSONObject());
            JSONObject result;
            try { result = new JSONObject(text); }
            catch (Exception error) { throw new IllegalStateException("The installation did not return an API response"); }
            return new Reply(status, result);
        } finally { connection.disconnect(); }
    }
}
