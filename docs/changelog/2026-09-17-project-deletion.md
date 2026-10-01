# Deleting a project now removes everything it owned

Deleting a project takes its documents, drafts and working history with it, while the firm's review records and the Brain keep what they learned.

### Improved
- Deleting a project now also removes its uploaded documents (including the stored files), report chat history, research sessions, drafting runs, snapshots and exports, instead of leaving them behind. Large projects are cleaned up in the background over a few seconds; the project disappears from the dashboard once the last of its records is gone.
- What is kept on purpose: review scores, comparison judgments, review decisions and QA feedback stay as the firm's audit record; Brain sources promoted from the project stay in the Brain (revoking them is a separate Brain action); chat threads held by the assistant service and the Brain's retrieval entries are not touched by deletion. Billing records, Brain feedback and ingestion history lose their link to the project but remain.
- A draft that is still generating when its project is deleted is stopped and marked failed, and any generation or QA work that was already in flight is fenced: when it comes back it finds the project marked for deletion and writes nothing.
- Behind-the-scenes reliability work: one registry now lists every record type a project owns, and the test suite fails if a new record type is added without saying what deletion should do with it.
