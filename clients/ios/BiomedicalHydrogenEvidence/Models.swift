import Foundation

struct SearchResponse: Decodable {
    let data: [StudySummary]
}

struct StudySummary: Decodable, Identifiable {
    let publicId: String
    let title: String
    let publicationYear: Int
    let speciesType: String
    let studyDesign: String
    let participantCount: Int?
    let administrationRoutes: [String]
    let verificationStatus: String
    let recordKind: String
    let fixtureNotice: String?

    var id: String { publicId }
}

struct StudyDetail: Decodable {
    struct Bibliography: Decodable {
        struct Author: Decodable, Identifiable {
            let name: String
            let orcid: String?
            let order: Int
            var id: String { "\(order)-\(name)" }
        }

        struct Links: Decodable {
            let source: URL?
            let doi: URL?
            let pubmed: URL?
            let pmc: URL?
        }

        let title: String
        let authors: [Author]
        let doi: String?
        let pmid: String?
        let pmcid: String?
        let journal: String?
        let publicationYear: Int
        let publicationDate: String?
        let language: String
        let publisher: String?
        let links: Links
    }

    struct Classification: Decodable {
        let biomedicalRelevance: Bool
        let speciesType: String
        let studyDesign: String
        let randomized: Bool?
        let blinded: Bool?
        let prospective: Bool?
        let peerReviewed: Bool?
    }

    struct Population: Decodable {
        let participantCount: Int?
        let analyzedParticipantCount: Int?
        let ageDescription: String?
        let sexDescription: String?
        let diseaseOrCondition: String?
        let conditionCanonical: String?
        let inclusionCriteria: String?
        let exclusionCriteria: String?
    }

    struct Intervention: Decodable, Identifiable {
        let molecularHydrogen: Bool
        let administrationRoute: String
        let hydrogenConcentration: String?
        let concentrationUnit: String?
        let flowRate: String?
        let flowUnit: String?
        let dissolvedHydrogenConcentration: String?
        let dissolvedHydrogenUnit: String?
        let dose: String?
        let durationPerSession: String?
        let frequency: String?
        let totalInterventionPeriod: String?
        let preparationMethod: String?
        let deviceInformation: String?
        let comparator: String?
        var id: String { "\(administrationRoute)-\(durationPerSession ?? "")-\(comparator ?? "")" }
    }

    struct Outcome: Decodable, Identifiable {
        let name: String
        let classification: String
        let measurementMethod: String?
        let interventionValue: String?
        let controlValue: String?
        let effectEstimate: String?
        let pValue: String?
        let confidenceInterval: String?
        let statisticallySignificant: Bool?
        let direction: String?
        let timePoint: String?
        var id: String { "\(classification)-\(name)-\(timePoint ?? "")" }
    }

    struct Safety: Decodable {
        let adverseEvents: String?
        let seriousAdverseEvents: String?
        let withdrawals: String?
        let conclusion: String?
    }

    struct Transparency: Decodable {
        let funding: String?
        let conflictOfInterest: String?
        let trialRegistration: String?
        let registrationNumber: String?
        let ethicsApproval: String?
    }

    struct Verification: Decodable {
        let status: String
        let note: String
    }

    let publicId: String
    let bibliography: Bibliography
    let classification: Classification
    let population: Population
    let interventions: [Intervention]
    let outcomes: [Outcome]
    let safety: Safety?
    let researchTransparency: Transparency?
    let verification: Verification
    let recordKind: String
    let fixtureNotice: String?
}
