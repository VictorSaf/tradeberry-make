-- the modules beyond Trade and Monitor a user may open (comma list of research, lab, coach); set from Administration
-- (functions/api/admin.js op modules) or tools/tb-user.mjs modules. Until now these were open to administrators only,
-- so the administrators keep all three and everyone else starts with none.
ALTER TABLE users ADD COLUMN modules TEXT NOT NULL DEFAULT '';
UPDATE users SET modules = 'research,lab,coach' WHERE admin = 1;
