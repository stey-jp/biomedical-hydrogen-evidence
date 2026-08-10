package jp.stey.biomedicalhydrogenevidence;

final class StudySummary {
    final String publicId;
    final String title;
    final int publicationYear;
    final String speciesType;
    final String studyDesign;
    final String verificationStatus;
    final String fixtureNotice;

    StudySummary(
        String publicId,
        String title,
        int publicationYear,
        String speciesType,
        String studyDesign,
        String verificationStatus,
        String fixtureNotice
    ) {
        this.publicId = publicId;
        this.title = title;
        this.publicationYear = publicationYear;
        this.speciesType = speciesType;
        this.studyDesign = studyDesign;
        this.verificationStatus = verificationStatus;
        this.fixtureNotice = fixtureNotice;
    }
}
