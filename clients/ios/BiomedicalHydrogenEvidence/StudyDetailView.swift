import SwiftUI

@MainActor
final class StudyDetailViewModel: ObservableObject {
    @Published private(set) var study: StudyDetail?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    func load(publicId: String) async {
        guard study == nil else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            study = try await APIClient.shared.study(publicId: publicId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct StudyDetailView: View {
    let publicId: String
    @StateObject private var model = StudyDetailViewModel()

    var body: some View {
        Group {
            if model.isLoading {
                ProgressView("読み込み中")
            } else if let error = model.errorMessage {
                ContentUnavailableView("取得できませんでした", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if let study = model.study {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let fixture = study.fixtureNotice {
                            notice(fixture, color: .orange)
                        }
                        notice("研究報告の存在は、医学的効果の確立を意味しません。", color: .secondary)
                        section("書誌情報") {
                            Text(study.bibliography.title).font(.title2.bold())
                            value("Year", String(study.bibliography.publicationYear))
                            value("Journal", study.bibliography.journal)
                            value("DOI", study.bibliography.doi)
                            if !study.bibliography.authors.isEmpty {
                                value("Authors", study.bibliography.authors.map(\.name).joined(separator: ", "))
                            }
                        }
                        section("研究分類") {
                            value("Species", study.classification.speciesType)
                            value("Design", study.classification.studyDesign)
                            value("Randomized", yesNo(study.classification.randomized))
                            value("Blinded", yesNo(study.classification.blinded))
                        }
                        section("対象") {
                            value("Participants", study.population.participantCount.map(String.init))
                            value("Condition", study.population.diseaseOrCondition)
                            value("Age", study.population.ageDescription)
                            value("Sex", study.population.sexDescription)
                        }
                        section("水素条件") {
                            ForEach(study.interventions) { intervention in
                                value("Route", intervention.administrationRoute)
                                value("Concentration", joined(intervention.hydrogenConcentration, intervention.concentrationUnit))
                                value("Duration", intervention.durationPerSession)
                                value("Frequency", intervention.frequency)
                                value("Comparator", intervention.comparator)
                            }
                        }
                        section("Outcomes") {
                            ForEach(study.outcomes) { outcome in
                                Text(outcome.name).font(.headline)
                                value("Classification", outcome.classification)
                                value("Effect", outcome.effectEstimate)
                                value("P value", outcome.pValue)
                                value("Direction", outcome.direction)
                            }
                        }
                        section("Verification") {
                            value("Status", study.verification.status)
                            Text(study.verification.note).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle(publicId)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(publicId: publicId) }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.bold())
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func value(_ label: String, _ value: String?) -> some View {
        Group {
            if let value, !value.isEmpty {
                Text("\(label): \(value)")
            }
        }
    }

    private func notice(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.footnote.bold())
            .foregroundStyle(color)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private func yesNo(_ value: Bool?) -> String? {
        value.map { $0 ? "Yes" : "No" }
    }

    private func joined(_ value: String?, _ unit: String?) -> String? {
        guard let value else { return nil }
        return [value, unit].compactMap { $0 }.joined(separator: " ")
    }
}
