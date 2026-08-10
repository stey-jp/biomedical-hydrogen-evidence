package jp.stey.biomedicalhydrogenevidence;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ApiClient apiClient = new ApiClient();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout results;
    private ProgressBar progress;
    private EditText query;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(buildContent());
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private View buildContent() {
        int padding = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(Color.rgb(245, 248, 247));

        TextView heading = text(getString(R.string.heading), 26, true);
        root.addView(heading);

        TextView notice = text(getString(R.string.notice), 14, false);
        notice.setPadding(0, dp(12), 0, dp(12));
        root.addView(notice);

        query = new EditText(this);
        query.setHint(R.string.search_hint);
        query.setSingleLine(true);
        query.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        query.setContentDescription(getString(R.string.search_hint));
        query.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_SEARCH) {
                performSearch();
                return true;
            }
            return false;
        });
        root.addView(query, new LinearLayout.LayoutParams(-1, -2));

        Button search = new Button(this);
        search.setText(R.string.search);
        search.setOnClickListener(view -> performSearch());
        root.addView(search, new LinearLayout.LayoutParams(-1, -2));

        progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        root.addView(progress);

        results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(results);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        return root;
    }

    private void performSearch() {
        setLoading(true);
        results.removeAllViews();
        String text = query.getText().toString().trim();
        executor.execute(() -> {
            try {
                List<StudySummary> studies = apiClient.search(text);
                runOnUiThread(() -> showStudies(studies));
            } catch (Exception error) {
                runOnUiThread(() -> showError(error));
            }
        });
    }

    private void showStudies(List<StudySummary> studies) {
        setLoading(false);
        if (studies.isEmpty()) {
            results.addView(text(getString(R.string.no_results), 16, false));
            return;
        }
        for (StudySummary study : studies) {
            Button item = new Button(this);
            item.setAllCaps(false);
            item.setText(study.title + "\n" + study.publicationYear + " · " + study.speciesType + " · " + study.verificationStatus);
            item.setContentDescription(study.title);
            item.setOnClickListener(view -> loadDetail(study));
            results.addView(item, new LinearLayout.LayoutParams(-1, -2));
            if (study.fixtureNotice != null) {
                TextView fixture = text(study.fixtureNotice, 13, true);
                fixture.setTextColor(Color.rgb(145, 71, 0));
                results.addView(fixture);
            }
        }
    }

    private void loadDetail(StudySummary study) {
        setLoading(true);
        executor.execute(() -> {
            try {
                String detail = apiClient.studyDetail(study.publicId);
                runOnUiThread(() -> {
                    setLoading(false);
                    new AlertDialog.Builder(this)
                        .setTitle(study.publicId)
                        .setMessage(detail)
                        .setPositiveButton(R.string.close, null)
                        .show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> showError(error));
            }
        });
    }

    private void showError(Exception error) {
        setLoading(false);
        results.removeAllViews();
        results.addView(text(getString(R.string.error_prefix, error.getMessage()), 16, false));
    }

    private void setLoading(boolean loading) {
        progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        query.setEnabled(!loading);
    }

    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(24, 43, 39));
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
