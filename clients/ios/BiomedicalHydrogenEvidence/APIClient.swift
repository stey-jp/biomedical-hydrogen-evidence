import Foundation

enum APIClientError: LocalizedError {
    case invalidURL
    case invalidResponse(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "API URLを作成できませんでした。"
        case .invalidResponse(let status):
            return "APIがHTTP \(status)を返しました。"
        }
    }
}

struct APIClient {
    static let shared = APIClient()
    private let baseURL = URL(string: "https://biomedical-hydrogen-evidence.flat-voice-876d.workers.dev")!
    private let decoder = JSONDecoder()

    func search(query: String) async throws -> [StudySummary] {
        var components = URLComponents(
            url: baseURL.appending(path: "/api/v1/search"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: "10"),
        ]
        guard let url = components?.url else { throw APIClientError.invalidURL }
        let response: SearchResponse = try await request(url)
        return response.data
    }

    func study(publicId: String) async throws -> StudyDetail {
        let encoded = publicId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? publicId
        return try await request(baseURL.appending(path: "/api/v1/studies/\(encoded)"))
    }

    private func request<Value: Decodable>(_ url: URL) async throws -> Value {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIClientError.invalidResponse(0) }
        guard (200..<300).contains(http.statusCode) else { throw APIClientError.invalidResponse(http.statusCode) }
        return try decoder.decode(Value.self, from: data)
    }
}
