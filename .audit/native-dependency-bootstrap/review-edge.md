# Independent edge review

Location: .bmad-loop/plugins/npm-bootstrap/plugin.toml:16
Trigger: Worker lacks package.json and a parent contains an npm project.
Suggested guard: require local package.json and package-lock.json or npm-shrinkwrap.json before npm.
Consequence: npm ci can replace ancestor dependencies before local probes fail, disrupting another active worker.
