package com.runeditrun.lodge;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** An initial native interview client. Pending edits never submit as a side effect of reconnecting. */
public final class MainActivity extends Activity {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private DraftVault vault;
    private LodgeApi api;
    private JSONObject saved;
    private LinearLayout page;
    private TextView status;
    private boolean busy, rendering;
    private String message = "Sign in to your installation to open an assigned interview kit.";
    private static final long CACHE_MILLIS = 8 * 60 * 60 * 1000L;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        vault = new DraftVault(this);
        try {
            String origin = getPreferences(0).getString("origin", "");
            if (!origin.isEmpty()) api = new LodgeApi(origin);
            saved = vault.read();
            if (saved != null && (api == null || !saved.optString("session").equals(api.identity()) || System.currentTimeMillis() > saved.optLong("expires"))) clear();
            if (saved != null) message = saved.optBoolean("submitted") ? "Submission previously confirmed by Lodge. Cached kit." : "Offline cached kit. Access has not been checked. Feedback remains unsubmitted.";
        } catch (Exception error) { clear(); message = "The private cache could not be opened. Sign in and open a fresh kit."; }
        if (saved == null) settings();
        else { start("Checking current access"); checkAccess(); }
    }
    @Override protected void onDestroy() { io.shutdown(); super.onDestroy(); }
    private void clear() { saved = null; if (vault != null) vault.clear(); }
    private LinearLayout start(String heading) {
        rendering = true;
        ScrollView scroll = new ScrollView(this);
        page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(24, 24, 24, 32);
        scroll.setFillViewport(true); scroll.addView(page); setContentView(scroll);
        TextView title = label(heading); title.setTextSize(26);
        status = label(message); status.setTextSize(16); status.setPadding(0, 12, 0, 20);
        return page;
    }
    private TextView label(String text) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(16); view.setPadding(0, 8, 0, 8); page.addView(view);
        return view;
    }
    private Button button(String text, Runnable action) {
        Button button = new Button(this); button.setText(text); button.setTextSize(16); page.addView(button);
        button.setOnClickListener(v -> { if (!busy) action.run(); }); return button;
    }
    private EditText input(String title, String value, int lines) {
        label(title);
        EditText field = new EditText(this); field.setTextSize(16); field.setHint(title); field.setContentDescription(title);
        field.setText(value); field.setMinLines(lines); field.setGravity(android.view.Gravity.TOP); page.addView(field);
        return field;
    }
    private void settings() {
        start("Lodge · Settings");
        EditText address = input("Installation or sign-in link", api == null ? "" : api.origin, 1);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        button("Sign in", () -> {
            try {
                LodgeApi chosen = new LodgeApi(address.getText().toString().trim());
                if (api == null || !api.origin.equals(chosen.origin)) { clear(); CookieManager.getInstance().removeAllCookies(null); }
                api = chosen;
                getPreferences(0).edit().putString("origin", api.origin).commit();
                signIn(address.getText().toString().trim());
            } catch (Exception error) { status.setText("Use a valid HTTPS installation address or its sign-in link."); }
        });
        if (api != null) button("Open assigned kits", this::loadKits);
        if (saved != null) button("Return to private draft", this::editor);
        button("Sign out and erase local drafts", () -> new AlertDialog.Builder(this).setMessage("Erase this device's cached kit and private draft?")
            .setPositiveButton("Erase and sign out", (d, w) -> work(() -> {
                boolean revoked = false;
                try { revoked = api != null && api.request("/auth/signout", new JSONObject()).code == 204; } catch (Exception ignored) {}
                boolean confirmed = revoked;
                runOnUiThread(() -> {
                    clear(); CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush();
                    message = confirmed ? "Signed out. Local kit and draft erased." : "Local session, kit and draft erased. Server sign-out could not be confirmed while disconnected.";
                    settings();
                });
            }))
            .setNegativeButton("Keep draft", null).show());
        label("This debug client supports interview kits and private offline feedback. Other mobile work and push reminders are not available.");
        rendering = false;
    }
    private void signIn(String url) {
        start("Sign in to Lodge");
        label("Request a sign-in email here. Paste its confirmation link under Settings to complete sign-in in this app.");
        WebView web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(false);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String next) {
                try { return !new LodgeApi(next).origin.equals(api.origin); } catch (Exception e) { return true; }
            }
        });
        page.addView(web, new LinearLayout.LayoutParams(-1, 550));
        web.loadUrl(url);
        button("Continue to assigned kits", () -> { CookieManager.getInstance().flush(); web.destroy(); loadKits(); });
        button("Settings", () -> { web.destroy(); settings(); });
        rendering = false;
    }
    private interface Work { void run() throws Exception; }
    private void work(Work action) {
        if (busy) return;
        busy = true; status.setText("Checking installation…");
        io.execute(() -> {
            try { action.run(); }
            catch (Exception error) { runOnUiThread(() -> { message = saved == null ? "Unable to connect. No kit was cached." : "Offline or confirmation unavailable. Cached kit only; feedback remains unsubmitted. Retry explicitly to reconcile."; editorOrSettings(); }); }
            finally { runOnUiThread(() -> busy = false); }
        });
    }
    private void editorOrSettings() { if (saved == null) settings(); else editor(); }
    private boolean denied(LodgeApi.Reply reply) {
        if (reply.code == 401 || reply.code == 403 || reply.code == 404) {
            runOnUiThread(() -> { clear(); message = "Access refused. Cached kit and private draft erased. Sign in and open a current assignment."; settings(); });
            return true;
        }
        return false;
    }
    private void loadKits() {
        if (api == null) { settings(); return; }
        work(() -> {
            LodgeApi.Reply reply = api.request("/api/lodge/state", null);
            if (denied(reply)) return;
            if (reply.code != 200) throw new IllegalStateException();
            String me = reply.body.getJSONObject("actor").getString("email");
            JSONArray interviews = reply.body.optJSONArray("interviews");
            runOnUiThread(() -> {
                start("Assigned interview kits");
                label("Open a kit while connected before drafting offline.");
                int count = 0;
                if (interviews != null) for (int i = 0; i < interviews.length(); i++) {
                    JSONObject iv = interviews.optJSONObject(i);
                    if (iv == null || "cancelled".equals(iv.optString("status")) || !contains(iv.optJSONArray("participants"), me)) continue;
                    count++;
                    button(iv.optString("title", "Interview kit"), () -> {
                        if (saved != null) {
                            start("Replace private draft?");
                            label("Discard the cached kit and its private draft before opening this kit? Your original feedback has not been submitted by opening another kit.");
                            button("Discard and open", () -> { clear(); openKit(iv.optString("id")); });
                            button("Keep draft", this::editor); rendering = false;
                        } else openKit(iv.optString("id"));
                    });
                }
                if (count == 0) label("No assigned interview kits.");
                if (saved != null) button("Return to private draft", this::editor);
                button("Settings", this::settings); rendering = false;
            });
        });
    }
    private static boolean contains(JSONArray array, String text) {
        if (array == null) return false;
        for (int i = 0; i < array.length(); i++) if (text.equals(array.optString(i))) return true;
        return false;
    }
    private void openKit(String id) {
        work(() -> {
            LodgeApi.Reply reply = api.request("/api/lodge/kit/" + id, null);
            if (denied(reply)) return;
            if (reply.code != 200 || !reply.body.has("offlineContext")) throw new IllegalStateException();
            JSONObject kit = reply.body;
            // Retain no colleagues' feedback, document bytes or contact details in the offline cache.
            kit.remove("feedback"); kit.remove("resume"); kit.remove("scorecard");
            JSONObject value = new JSONObject().put("kit", kit).put("session", api.identity()).put("expires", System.currentTimeMillis() + CACHE_MILLIS)
                .put("submissionId", UUID.randomUUID().toString()).put("ratings", new JSONObject()).put("evidence", new JSONObject())
                .put("recommendation", "").put("takeaways", "").put("notes", "").put("submitted", false);
            vault.write(value);
            runOnUiThread(() -> { saved = value; message = "Kit cached for up to eight hours. Private draft saved on this device; not submitted."; editor(); });
        });
    }
    private void saveField(String key, String value, String criterion) {
        if (rendering || saved == null || saved.optBoolean("submitted") || saved.has("pendingRequest")) return;
        try {
            if (criterion == null) saved.put(key, value); else saved.getJSONObject(key).put(criterion, value);
            vault.write(saved);
            status.setText("Private draft saved on this device. Not submitted. Cached kit; access last checked when opened.");
        } catch (Exception error) { status.setText("Draft could not be saved. Keep this screen open and free device storage."); }
    }
    private void watch(EditText field, String key, String criterion) {
        field.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) { saveField(key, s.toString(), criterion); }
            public void afterTextChanged(Editable value) {}
        });
    }
    private void editor() {
        if (saved == null) { settings(); return; }
        try {
            if (api == null || !saved.optString("session").equals(api.identity()) || System.currentTimeMillis() > saved.optLong("expires")) {
                clear(); message = "Cached access expired or sign-in changed. Local kit and draft erased."; settings(); return;
            }
            JSONObject kit = saved.getJSONObject("kit");
            start("Private interview feedback");
            label(kit.getJSONObject("candidate").getString("name") + " · " + kit.getJSONObject("vacancy").getString("title"));
            label(kit.optString("purpose"));
            JSONArray questions = kit.optJSONArray("questions");
            if (questions != null) for (int i = 0; i < questions.length(); i++) label(questions.optString(i));
            if (saved.optBoolean("submitted")) label("Submission confirmed by Lodge. Private feedback stays subject to the normal release rules.");
            else if (saved.has("pendingRequest")) {
                label("Confirmation pending. The exact submitted text is frozen until reconciled. No submission is assumed.");
                button("Retry confirmation explicitly", this::submit);
            } else {
                JSONArray criteria = kit.getJSONArray("focus");
                for (int i = 0; i < criteria.length(); i++) {
                    JSONObject c = criteria.getJSONObject(i); String id = c.getString("id");
                    label(c.getString("name") + " · " + c.optString("description"));
                    EditText rating = input("Rating from 1 to 4 (or blank)", saved.getJSONObject("ratings").optString(id), 1);
                    rating.setInputType(android.text.InputType.TYPE_CLASS_NUMBER); watch(rating, "ratings", id);
                    watch(input("Evidence for " + c.getString("name"), saved.getJSONObject("evidence").optString(id), 2), "evidence", id);
                }
                String[] choices = {"Choose recommendation", "Strong no", "No", "Yes", "Strong yes"};
                String[] values = {"", "strong-no", "no", "yes", "strong-yes"};
                label("Overall recommendation");
                Spinner recommendation = new Spinner(this);
                ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, choices);
                recommendation.setAdapter(adapter); page.addView(recommendation);
                for (int i = 0; i < values.length; i++) if (values[i].equals(saved.optString("recommendation"))) recommendation.setSelection(i);
                recommendation.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                    public void onNothingSelected(AdapterView<?> parent) {}
                    public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                        if (!values[position].equals(saved.optString("recommendation"))) saveField("recommendation", values[position], null);
                    }
                });
                watch(input("Key take-aways", saved.optString("takeaways"), 3), "takeaways", null);
                watch(input("Private notes", saved.optString("notes"), 3), "notes", null);
                button("Submit feedback explicitly", this::submit);
                button("Check current access", this::checkAccess);
            }
            button("Assigned kits", this::loadKits); button("Settings", this::settings);
            rendering = false;
        } catch (Exception error) { clear(); message = "Unreadable draft. Open a fresh kit."; settings(); }
    }
    private void checkAccess() {
        work(() -> {
            LodgeApi.Reply reply = api.request("/api/lodge/kit/" + saved.getJSONObject("kit").getJSONObject("interview").getString("id"), null);
            if (denied(reply)) return;
            if (reply.code != 200) throw new IllegalStateException();
            boolean same = saved.getJSONObject("kit").getString("offlineContext").equals(reply.body.optString("offlineContext"));
            runOnUiThread(() -> {
                message = saved.optBoolean("submitted") ? "Previous submission confirmed. Current kit access checked."
                    : saved.has("pendingRequest") ? "Confirmation pending. Current kit access checked. Retry the frozen request explicitly to reconcile."
                    : same ? "Access confirmed. Private feedback remains unsubmitted."
                    : "Conflict: kit, rubric, assignment or draft changed. Original feedback remains unsubmitted. Review online before discarding this draft.";
                editor();
            });
        });
    }
    private void submit() {
        try {
            JSONObject kit = saved.getJSONObject("kit");
            JSONObject body = saved.has("pendingRequest") ? saved.getJSONObject("pendingRequest") : new JSONObject().put("application", kit.getString("application")).put("interview", kit.getJSONObject("interview").getString("id"))
                .put("offlineContext", kit.getString("offlineContext")).put("rubricVersion", kit.getInt("rubricVersion"))
                .put("submissionId", saved.getString("submissionId")).put("ratings", saved.getJSONObject("ratings"))
                .put("evidence", saved.getJSONObject("evidence")).put("recommendation", saved.getString("recommendation"))
                .put("takeaways", saved.getString("takeaways")).put("notes", saved.getString("notes")).put("submit", true);
            // Persist the immutable request before starting transport, including across process death.
            saved.put("pendingRequest", new JSONObject(body.toString())); vault.write(saved);
            message = "Confirmation pending. Feedback has not been confirmed submitted."; editor();
            work(() -> {
                LodgeApi.Reply reply = api.request("/api/lodge/command/scorecard", body);
                if (denied(reply)) return;
                if (reply.code != 200) {
                    String error = reply.body.optString("error", "Submission refused");
                    if (reply.code >= 400 && reply.code < 500 && reply.code != 408 && reply.code != 429) { saved.remove("pendingRequest"); vault.write(saved); }
                    runOnUiThread(() -> { message = "Unsubmitted: " + error; editor(); }); return;
                }
                if (!"submitted".equals(reply.body.optString("status")) || !body.getString("application").equals(reply.body.optString("application")) ||
                    !body.getString("interview").equals(reply.body.optString("interview")) ||
                    !body.getString("submissionId").equals(reply.body.getJSONObject("offlineSubmission").optString("id"))) throw new IllegalStateException();
                saved.remove("pendingRequest"); saved.put("submitted", true);
                for (String key : new String[]{"ratings", "evidence"}) saved.put(key, new JSONObject());
                for (String key : new String[]{"recommendation", "takeaways", "notes"}) saved.put(key, "");
                vault.write(saved);
                runOnUiThread(() -> { message = "Submission confirmed by Lodge."; editor(); });
            });
        } catch (Exception error) { status.setText("Unable to prepare feedback. Draft remains unsubmitted."); }
    }
}
