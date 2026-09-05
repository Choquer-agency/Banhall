# Root independent UI review

Review input for ui-1-component-suite-green only. Evaluate these observations against the final source and ticket; classify independently under the normal protocol. They are not permission changes or a predetermined verdict.

Root inspected all four real screenshots and both geometry probe logs. Mobile New project is41x32before and44x44after; desktop121.67x32both, and desktop PNG bytes are identical (SHA256dc469843e16b32c1bcfe8aa723693eb01ff0a234e66d4c3f5d524831fe72eaa9). Full suite currently51files/292cases passes. Only the header caller changes production. Button, Rail and routes assertions retain their contracts; the temporary probe was removed.

Independent source reviewer identified three small verification gaps to assess:

- AC3 says follow Settings by role/name. WorkspaceChrome.component.test.ts currently only locates the link and reads its href; it does not exercise its click/drawer-close path. Determine whether the criterion needs the actual interaction, keeping the separate sign-out cancellation proof intact.
- The confirmation controls are measured only for height. The mobile target contract uses both dimensions; include width in the existing geometry predicate if needed.
- The new Header geometry test leaves viewport1280x800 rather than restoring its incoming viewport. The ticket explicitly calls for viewport cleanup; assess the current harness reset behavior and preserve test isolation.

Do not alter product behavior beyond the ticket. Root observations came from source and existing real artifacts; no extra root browser run was started alongside the implementer.
