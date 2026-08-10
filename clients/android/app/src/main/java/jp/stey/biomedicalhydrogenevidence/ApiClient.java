package jp.stey.biomedicalhydrogenevidence;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class ApiClient {
    private static final int TIMEOUT_MILLIS = 15_000;

    List<StudySummary> search(String query) throws IOException, JSONException {
        String encoded = URLEncoder.encode(query, StandardCharsets.UTF_8.name());
        JSONObject response = getJson("/api/v1/search?query=" + encoded + "&limit=10");
        JSONArray data = response.getJSONArray("data");
        List<StudySummary> studies = new ArrayList<>();
        for (int index = 0; index < data.length(); index += 1) {
            JSONObject item = data.getJSONObject(index);
            studies.add(new StudySummary(
                item.getString("publicId"),
                item.getString("title"),
                item.optInt("publicationYear"),
                item.optString("speciesType", "unknown"),
                item.optString("studyDesign", "unknown"),
                item.optString("verificationStatus", "unverified"),
                item.isNull("fixtureNotice") ? null : item.optString("fixtureNotice")
            ));
        }
        return studies;
    }

    String studyDetail(String publicId) throws IOException, JSONException {
        JSONObject study = getJson("/api/v1/studies/" + URLEncoder.encode(publicId, StandardCharsets.UTF_8.name()));
        JSONObject bibliography = study.getJSONObject("bibliography");
        JSONObject classification = study.getJSONObject("classification");
        JSONObject verification = study.getJSONObject("verification");
        StringBuilder detail = new StringBuilder();
        detail.append(bibliography.getString("title"));
        detail.append("\n\nYear: ").append(bibliography.optInt("publicationYear"));
        detail.append("\nSpecies: ").append(classification.optString("speciesType", "unknown"));
        detail.append("\nDesign: ").append(classification.optString("studyDesign", "unknown"));
        detail.append("\nVerification: ").append(verification.optString("status", "unverified"));
        if (!study.isNull("fixtureNotice")) {
            detail.append("\n\n").append(study.optString("fixtureNotice"));
        }
        detail.append("\n\n研究報告の存在は、医学的効果の確立を意味しません。");
        return detail.toString();
    }

    private JSONObject getJson(String route) throws IOException, JSONException {
        HttpURLConnection connection = null;
        try {
            URI uri = URI.create(BuildConfig.API_BASE_URL + route);
            connection = (HttpURLConnection) uri.toURL().openConnection();
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setConnectTimeout(TIMEOUT_MILLIS);
            connection.setReadTimeout(TIMEOUT_MILLIS);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("HTTP " + status);
            return new JSONObject(readAll(connection.getInputStream()));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String readAll(InputStream input) throws IOException {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
