# Development Tasks and Roadmap

This document serves as the single source of truth for all development tasks, including known issues, planned features, and future improvements.

---

### High-Priority Tasks & Bugs
*These are items that should be addressed in the near future.*

- **[BUG] Machine Untracking:** Improve the logic for untracking a machine when its entire section is removed to prevent potential state inconsistencies.
- **[VALIDATION] Meter Readings:** Implement validation to ensure `compteurMoteurFin` is greater than or equal to `compteurMoteurDebut`.
- **[VALIDATION] Resource Quantity:** Add validation to prevent non-numeric or negative values for resource quantities.
- **[VALIDATION] Date Range:** Consider adding restrictions to prevent users from entering data for dates too far in the past or future.

---

### Future Enhancements & Performance
*These are planned features and optimizations to improve the application.*

- **[PERFORMANCE] Batch SharePoint Sync:** Refactor the `syncQueuedEntries` function to use the Microsoft Graph API's batch endpoint. This will allow multiple entries to be created/updated in a single network request, significantly improving performance and reducing API calls.
- **[PERFORMANCE] Machine List Filtering:** Optimize the client-side filtering of the machine list, especially if the list grows large.
- **[FEATURE] Machine Type or Zone Activite Filtering:** Add a UI element (e.g., a dropdown) to allow users to filter the machine list by `machineType` or `zoneActivite`.
- **[UX] Improved Feedback:** Enhance UI feedback for loading states, errors, and successful operations to make the application more intuitive.
- **[UX] Resource Visualization:** Consider adding simple charts or graphs to visualize resource consumption over time.
- **[OFFLINE] Better Offline Support:** Improve the handling of the machine list when the application is started in offline mode, ensuring a more seamless experience.

---

### Security & Deployment
*Tasks related to securing the application and preparing for production.*

- **[SECURITY] Secure Configuration:** Develop and document a clear process for managing production secrets (e.g., MSAL Client ID). This should involve using environment variables or a secure vault, not the `config.global.js` file.
- **[SECURITY] Payload Security:** Investigate and document best practices for securing POST/PATCH payloads sent to SharePoint, although this is largely handled by HTTPS and bearer token authentication.
