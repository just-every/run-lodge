package com.runeditrun.lodge;

import android.content.Intent;
import android.os.SystemClock;
import android.test.InstrumentationTestCase;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/** Installed native views, native durable storage, and the real authenticated Worker. No app or API fake. */
public final class OfflineJourney extends InstrumentationTestCase {
    private static byte[] readBytes(java.io.InputStream stream) throws java.io.IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }
    private MainActivity activity;
    private String fixture;
    private JSONObject data;
    private JSONObject control(String action) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(fixture + "/" + action).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(action.startsWith("proof-") ? 120000 : 15000);
        try (var stream = c.getInputStream()) { return new JSONObject(new String(readBytes(stream), StandardCharsets.UTF_8)); }
        finally { c.disconnect(); }
    }
    private interface Check { boolean ok() throws Exception; }
    private void until(Check check) throws Exception {
        long end = SystemClock.uptimeMillis() + 60000;
        while (SystemClock.uptimeMillis() < end) {
            final boolean[] result = {false};
            final Exception[] error = {null};
            getInstrumentation().runOnMainSync(() -> { try { result[0] = check.ok(); } catch (Exception e) { error[0] = e; } });
            if (result[0]) return;
            SystemClock.sleep(200);
        }
        fail("Timed out waiting for native state; screen: " + screen());
    }
    private ArrayList<TextView> texts() {
        ArrayList<TextView> out = new ArrayList<>();
        collect(activity.getWindow().getDecorView(), out); return out;
    }
    private void collect(View view, ArrayList<TextView> result) {
        if (view instanceof TextView) result.add((TextView) view);
        if (view instanceof ViewGroup) for (int i=0; i<((ViewGroup)view).getChildCount(); i++) collect(((ViewGroup)view).getChildAt(i), result);
    }
    private String screen() {
        StringBuilder out = new StringBuilder();
        for (TextView v : texts()) out.append(v.getText()).append("\n");
        return out.toString();
    }
    private boolean has(String text) {
        for (TextView v : texts()) if (v.getText().toString().contains(text)) return true;
        return false;
    }
    private void click(String text) throws Exception {
        until(() -> has(text));
        getInstrumentation().runOnMainSync(() -> {
            for (TextView v : texts()) if (v instanceof Button && v.getText().toString().equals(text)) { v.performClick(); return; }
            fail("Missing button: " + text);
        });
        SystemClock.sleep(500);
    }
    private void edit(String description, String value) {
        getInstrumentation().runOnMainSync(() -> {
            int count=0;
            for (TextView v : texts()) if (v instanceof EditText && description.equals(String.valueOf(v.getContentDescription()))) { v.setText(value); count++; }
            assertTrue("Missing field " + description, count > 0);
        });
    }
    @Override protected void setUp() throws Exception {
        super.setUp();
        fixture = JourneyRunner.options.getString("fixture");
        data = control("fixture");
        Intent intent = new Intent(getInstrumentation().getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = (MainActivity) getInstrumentation().startActivitySync(intent);
        getInstrumentation().waitForIdleSync();
    }
    private void open() throws Exception {
        click("Open assigned kits");
        until(() -> has("synthetic-lodge-native"));
        click("Floor walk: synthetic-lodge-native");
        until(() -> has("Key take-aways"));
    }
    private void fill(String text) throws Exception {
        edit("Rating from 1 to 4 (or blank)", "3");
        edit("Evidence for Site safety", "Described an actual safety review.");
        edit("Evidence for Scheduling", "Explained the recovery of a delayed delivery.");
        edit("Key take-aways", text);
        getInstrumentation().runOnMainSync(() -> {
            choose(activity.getWindow().getDecorView());
        });
        SystemClock.sleep(500);
    }
    private void choose(View v) {
        if (v instanceof Spinner) ((Spinner)v).setSelection(3);
        if (v instanceof ViewGroup) for (int i=0; i<((ViewGroup)v).getChildCount(); i++) choose(((ViewGroup)v).getChildAt(i));
    }
    private void proof(String state) throws Exception {
        // Only this synthetic instrumentation session temporarily permits the host's screenshots.
        getInstrumentation().runOnMainSync(() -> activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE));
        control("proof-" + state);
        getInstrumentation().runOnMainSync(() -> activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE));
    }
    public void testDraftOffline() throws Exception {
        edit("Installation or sign-in link", data.getString("origin"));
        click("Sign in");
        getInstrumentation().runOnMainSync(() -> CookieManager.getInstance().setCookie(data.optString("origin"), data.optString("cookie")));
        getInstrumentation().waitForIdleSync();
        click("Continue to assigned kits");
        until(() -> has("synthetic-lodge-native"));
        click("Floor walk: synthetic-lodge-native");
        until(() -> has("Key take-aways"));
        control("offline");
        fill("synthetic-lodge-native durable private feedback");
        assertTrue(has("Private draft saved on this device"));
        assertTrue(has("Not submitted"));
        assertEquals(0, control("stats").getInt("submitted"));
        DraftVault vault = new DraftVault(getInstrumentation().getTargetContext());
        assertEquals("synthetic-lodge-native durable private feedback", vault.read().getString("takeaways"));
        proof("offline");
        byte[] encrypted = java.nio.file.Files.readAllBytes(new java.io.File(getInstrumentation().getTargetContext().getNoBackupFilesDir(), "feedback.enc").toPath());
        assertFalse(new String(encrypted, StandardCharsets.UTF_8).contains("durable private feedback"));
    }
    public void testRestartAndReconnect() throws Exception {
        until(() -> has("Cached kit only"));
        assertTrue(has("synthetic-lodge-native durable private feedback"));
        assertEquals(0, control("stats").getInt("submitted"));
        control("online");
        control("rubric");
        click("Submit feedback explicitly");
        until(() -> has("Unsubmitted:") && has("changed"));
        assertTrue(has("synthetic-lodge-native durable private feedback"));
        assertEquals(0, control("stats").getInt("submitted"));
        proof("conflict");
        // A new current kit requires an explicit discard rather than silently adopting new terms.
        click("Assigned kits");
        until(() -> has("synthetic-lodge-native"));
        click("Floor walk: synthetic-lodge-native");
        click("Discard and open");
        until(() -> has("Key take-aways"));
        fill("synthetic-lodge-native current feedback");
        control("lose-confirmation");
        click("Submit feedback explicitly");
        until(() -> has("Retry confirmation explicitly"));
        assertEquals(1, control("stats").getInt("submitted"));
        assertFalse(has("Submission confirmed by Lodge."));
        proof("uncertain");
    }
    public void testReconcileAndRevocation() throws Exception {
        until(() -> has("Retry confirmation explicitly"));
        control("allow-confirmation");
        click("Retry confirmation explicitly");
        until(() -> has("Submission confirmed by Lodge."));
        assertEquals(1, control("stats").getInt("submitted"));
        assertEquals(1, control("stats").getInt("audits"));
        proof("confirmed");
        // A second assignment proves role and session loss clear the device's private cache.
        control("next");
        click("Assigned kits");
        until(() -> has("synthetic-lodge-native"));
        click("Floor walk: synthetic-lodge-native");
        click("Discard and open");
        until(() -> has("Key take-aways"));
        fill("synthetic-lodge-native revoked draft");
        control("role");
        click("Submit feedback explicitly");
        until(() -> has("Access refused"));
        assertFalse(has("synthetic-lodge-native revoked draft"));
        assertNull(new DraftVault(getInstrumentation().getTargetContext()).read());
        control("restore-role");
        open();
        fill("synthetic-lodge-native revoked session");
        control("revoke");
        click("Submit feedback explicitly");
        until(() -> has("Access refused"));
        assertNull(new DraftVault(getInstrumentation().getTargetContext()).read());
        assertEquals(1, control("stats").getInt("submitted"));
        proof("revoked");
    }
}
