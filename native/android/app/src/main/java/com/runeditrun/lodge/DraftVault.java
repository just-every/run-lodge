package com.runeditrun.lodge;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

/** Only the selected kit and its private draft are persisted, encrypted and excluded from backups. */
final class DraftVault {
    private final AtomicFile file;
    DraftVault(Context context) { file = new AtomicFile(new File(context.getNoBackupFilesDir(), "feedback.enc")); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias("lodge-feedback")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("lodge-feedback", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            return generator.generateKey();
        }
        return (SecretKey) store.getKey("lodge-feedback", null);
    }
    synchronized void write(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        byte[] bytes = ByteBuffer.allocate(1 + cipher.getIV().length + encrypted.length).put((byte) cipher.getIV().length).put(cipher.getIV()).put(encrypted).array();
        FileOutputStream stream = file.startWrite();
        try { stream.write(bytes); file.finishWrite(stream); }
        catch (Exception error) { file.failWrite(stream); throw error; }
    }
    synchronized JSONObject read() throws Exception {
        if (!file.getBaseFile().exists()) return null;
        ByteBuffer bytes = ByteBuffer.wrap(file.readFully());
        int n = bytes.get() & 255;
        if (n != 12 || bytes.remaining() < n + 16) throw new IllegalStateException("Unreadable private draft");
        byte[] iv = new byte[n]; bytes.get(iv);
        byte[] encrypted = new byte[bytes.remaining()]; bytes.get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
    }
    synchronized void clear() { file.delete(); }
}
