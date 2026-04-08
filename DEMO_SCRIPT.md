# Banhall Demo Script — Client Walkthrough
**Duration:** ~5-6 minutes | **Format:** Loom screen recording

---

## INTRO (30 seconds)

> Hey [Client Name], Bryce here. I wanted to send you a quick walkthrough of what we've been building while we wait on the real transcript and a finished report sample from your team. I figured rather than sit idle, I'd be proactive and get the platform to a place where you can actually see it, touch it, and give us feedback. So what you're looking at here is V1 — the first working version of the SR&ED report generator. Let me walk you through how it works.

---

## DASHBOARD (30 seconds)

*Show the dashboard page*

> This is the dashboard — it's where your team will land after logging in. You can see all your projects at a glance, filter by status — Draft, Review, Client Review, Final — and create new ones. Each card shows the project name, client, and current status. Think of this as your command center for all active SR&ED claims.

---

## CREATING A PROJECT (45 seconds)

*Click "New Project" and show the form*

> Creating a project is straightforward. You fill in the project title, the client name, who the writer is, who conducted the interview, and then you paste in the interview transcript. That's it. Once you hit Generate Report, the AI pipeline kicks off in the background. You don't have to wait — it'll take you straight to the project page and you can watch it work in real time.

> Now, since we didn't have a real transcript to work with, I used the sample documents your team sent over and built a test case around that. The output you'll see is based on that — so keep in mind, once we have real interview data, the quality and specificity of the output will be significantly better.

---

## THE AI PIPELINE & REPORT (60 seconds)

*Show a generated report on the project page — scroll through it*

> Here's where it gets interesting. The system runs five AI agents in sequence. First, it analyzes the transcript and extracts everything — the company context, the uncertainties, the experiments, the advancements. Then it drafts each of the three CRA sections in parallel — Line 242 for Scientific Uncertainty, Line 244 for Work Performed, and Line 246 for Technological Advancement. Finally, a QA agent scores the entire report against CRA criteria.

> What you're looking at is a fully structured SR&ED report. Every section follows the exact paragraph structure that CRA reviewers expect. The required signal phrases — "The limitations to standard practice were," "The technological objective was to," "It was hypothesized that if" — they're all placed exactly where an RTA would scan for them. The system also enforces things like banned words, repetition limits, and knowledge-first framing in the advancement section. It's not just generating text — it's encoding your methodology.

---

## THE EDITOR (45 seconds)

*Click into the report, make a small edit, show slash commands*

> The report is fully editable. Your writers can go in, refine the language, adjust phrasing, add detail. It's a rich text editor — you can type a forward slash to insert headings, dividers, code blocks, whatever you need. Changes save automatically in real time.

> At the top of each project, you'll see the metadata — the client, the writer, the interviewer, and the creation date. This gives you context at a glance without having to dig through files.

---

## COMMENTS & COLLABORATION (45 seconds)

*Highlight some text, show the comment appearing in the margin*

> One of the features I'm most excited about is the comment system. You can highlight any text in the report and leave a note right in the margin — just like you would in Google Docs, but purpose-built for SR&ED review. When you hover over highlighted text, the corresponding comment lights up on the right side so you can immediately see what note goes with what passage.

> This works for internal review, but it also works for client review — which I'll show you in a second.

---

## QA SCORING (60 seconds)

*Scroll down to the QA Score Panel, expand it*

> Below the report, you'll find the QA scorecard. This is the AI's honest assessment of the draft. Each section gets its own score out of 100, and there's an overall score for the full report. It checks for CRA compliance — are the required phrases present, is the WHY-HOW-WHY structure intact, are the uncertainties properly distinguished between passive and active.

> It also flags specific issues — language problems, banned words that slipped through, areas where the framing could be stronger. And down here, you'll see follow-up questions for the client. These are gaps the system identified where more information is needed from the interviewee. Your writers can use these to guide their follow-up conversations.

> There's also a chronology table that maps each experiment to the uncertainty it addresses, the type of work, and the hours — which will auto-populate once timesheet data is uploaded.

---

## SHARE & CLIENT REVIEW (45 seconds)

*Click Share, show the URL, then open the review page*

> When the writer is satisfied with the draft, they can send it to the client for review. You hit Share, copy the link, and send it over. The client doesn't need an account — they enter their name and they're in. They see the full report in read-only mode, but they can highlight text and leave comments just like the writer can. Their comments show up in a different color so you can tell them apart at a glance.

> Once the client has reviewed it, the writer brings it back, addresses the feedback, and marks it as final.

---

## EXPORT (15 seconds)

*Click Export .docx*

> And when everything is finalized, one click exports the entire report as a Word document — ready to attach to the T661 filing.

---

## CLOSING (45 seconds)

> So that's V1. To be upfront — this is a starting point. The report quality is directly tied to the quality of the input transcript. With the sample data we had, the system scored a 92 out of 100 on its own QA check, which puts it in the range where a senior writer would need maybe 15 minutes of polish rather than hours of rewriting.

> Once we have a real transcript and a finished report to benchmark against, we can fine-tune the prompts, calibrate the scoring, and get this to a place where it's genuinely saving your team significant time on every claim.

> I'd love for you and your team to log in, run a test with your own data, and let me know what you think. I'm all ears on feedback — what's working, what's not, what you'd want to see next. This is very much a collaborative build.

> Talk soon.

---

**Total runtime: ~5.5 minutes**
