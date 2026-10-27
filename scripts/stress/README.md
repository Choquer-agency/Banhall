# Stress test (F5)

Plan: `docs/todos/phase-f-scale.md`, F5. Local deployments only, with real models and a spend cap the owner sets.

1. Collect the deployment's names (clients, their other names, projects, interviewees, speakers, users) into a JSON array, for example with `npx convex run --inline-query` on the local deployment.
2. `node scripts/stress/generate.mjs --out /tmp/stress --names names.json`: 50 files of 400,000 characters, one at the 1,000,000-character maximum, one a character over it, and a 3-hour interview, all in invented words. It stops if any name from the list appears.
3. `node scripts/stress/run.mjs --data /tmp/stress --config <checkout>/.convex/local/default/config.json --subject <auth subject> --cap <USD> --confirm-spend --out results.json`: makes the company and an evaluation project (left out of learning), uploads everything (the file over the maximum must be refused by name), waits for search pieces and file labels, starts a Step by step draft and waits for its Seeds. Each step records its time, result and the spend so far; it stops at the cap.
4. The later steps (20 picks in one step, a 46-entry Brief, every check failing, chat at scale, a duplicate, two drafts at once, 100 files) are run by hand and added to the results.
5. Erase the project through the app afterwards.
