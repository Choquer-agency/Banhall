/**
 * Setup for the component test suite (`npm run test:component`).
 *
 * One-time contributor setup: `npx playwright install chromium`.
 *
 * Importing the app stylesheet is what makes geometry, focus-ring, and
 * reduced-motion assertions meaningful: without real CSS a test can only check
 * that a class name is present, which proves nothing about what the user sees.
 */
import "../../routes/layout.css";
