# Explicit prospect capture

This unpacked Chromium extension supports ordinary secure web pages only. It has no Lodge credential, cookie access, private read API, background capture or stored personal fields. LinkedIn and inbox capture are not supported.

In Chromium's extension settings, enable Developer mode, choose **Load unpacked**, and select this directory. Sign in to your Lodge installation in the same browser. On a source page, open **Capture prospect** from the extension action. Select visible text and explicitly choose **Use selected text as name**, or type the details. Enter your installation origin and choose **Review in Lodge**.

The native review page clears the fragment immediately. It requires a currently authorized human, a job or the native talent pool, recorded consent basis, an explicit decision for each visible duplicate and final confirmation. A match grants no access and never merges or overwrites people. Canceling or closing discards transient details. Sign in first: a sign-in redirect intentionally does not retain a pending capture. Source page query parameters and fragments are removed to avoid retaining tracking or capability values.

The extension requests only active-tab and scripting permissions. It reads selection only after the explicit button press; it does not inspect page fields, hidden content, other tabs or email threads. Details remain only in the popup and transient handoff fragment. Browser tab and navigation machinery necessarily handle the fragment until the native page clears it; this is not a claim to erase browser or device forensic history. No personal fields are stored by the extension.

Edge, provider pages, packaged distribution, inbox add-ons and member-scoped add-on credentials remain outside this increment's proof and within CRM-007's complete target.
