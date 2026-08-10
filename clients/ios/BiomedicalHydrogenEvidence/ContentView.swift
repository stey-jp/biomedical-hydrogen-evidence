import SwiftUI

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var studies: [StudySummary] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    func search() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            studies = try await APIClient.shared.search(query: query.trimmingCharacters(in: .whitespacesAndNewlines))
        } catch {
            studies = []
            errorMessage = error.localizedDescription
        }
    }
}

struct ContentView: View {
    @StateObject private var model = SearchViewModel()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("研究報告が存在することと、医学的効果が確立していることは異なります。診断・治療の助言ではありません。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("医学的効果と医療助言に関する注意")
                }

                Section("検索") {
                    TextField("例: 水素吸入", text: $model.query)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .onSubmit { Task { await model.search() } }
                    Button("検索") { Task { await model.search() } }
                        .disabled(model.isLoading)
                }

                if model.isLoading {
                    ProgressView("読み込み中")
                } else if let message = model.errorMessage {
                    Text(message).foregroundStyle(.red)
                } else if model.studies.isEmpty {
                    Text("検索語を入力してください。")
                        .foregroundStyle(.secondary)
                } else {
                    Section("研究") {
                        ForEach(model.studies) { study in
                            NavigationLink(value: study.publicId) {
                                StudyRow(study: study)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Hydrogen Evidence")
            .navigationDestination(for: String.self) { publicId in
                StudyDetailView(publicId: publicId)
            }
        }
    }
}

private struct StudyRow: View {
    let study: StudySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(study.title).font(.headline)
            Text("\(study.publicationYear) · \(study.speciesType) · \(study.studyDesign)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Verification: \(study.verificationStatus)")
                .font(.caption)
            if let fixture = study.fixtureNotice {
                Text(fixture)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
    }
}
