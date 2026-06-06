# Quality Audit Report - squisq

This report documents three high-impact bugs identified during the initial quality audit of the codebase.

## 🐛 High-Impact Bugs

### 1. Insufficient Geodesic Accuracy in Path Interpolation (Geohash.ts)

*   **File Path:** `packages/core/src/spatial/Geohash.ts`
*   **Line Number:** ~105 (within `getGeohashPath`)
*   **Symptom:** When calculating the path between two geohashes that are far apart or near the poles, the linear interpolation used to determine intermediate lat/lng points (`t = i / steps`) is not geodesic. This can lead to an underestimation of the true distance, resulting in `steps` being too low and causing the function to skip over intermediate geohash cells, potentially corrupting file organization.
*   **Suggested Fix:** Implement a path-finding algorithm that follows the great-circle route (e.g., using spherical geometry libraries or a more sophisticated iterative approach) instead of linear interpolation, ensuring all relevant cells along the shortest path are covered.

### 2. Shallow Validation of ImageEditDoc Schema (persistence.ts)

*   **File Path:** `packages/core/src/imageEdit/persistence.ts`
*   **Line Number:** ~56 (within `assertImageEditDoc`)
*   **Symptom:** The current schema assertion (`assertImageEditDoc`) only checks for the existence and basic type of top-level fields (e.g., `version`, `canvas`, `layers`). It does not validate the internal structure or required fields within complex objects (like individual layers inside `v.layers`). A slightly malformed but parsable JSON file could pass the current checks and lead to a silent, hard-to-debug runtime crash later in the application logic.
*   **Suggested Fix:** Implement deeper, recursive validation of `ImageEditDoc` structure within `assertImageEditDoc`. This should check that every object in the `layers` array conforms to the required sub-schema before accepting the document.

### 3. Non-Graceful Error Handling on Malformed Geohash Input (Geohash.ts)

*   **File Path:** `packages/core/src/spatial/Geohash.ts`
*   **Line Number:** ~63 and ~94 (within `getGeohash4Neighbors` and `geohashToHierarchicalPath`)
*   **Symptom:** Functions like `getGeohash4Neighbors` throw a standard JavaScript `Error` if the input geohash string is not exactly 4 characters long. This forces all consumers of these functions to implement explicit `try...catch` blocks for expected input errors. For utility functions, it is often better practice to return a predictable value (e.g., `[]` or `null`) on invalid input rather than throwing an unhandled exception, promoting more resilient API usage.
*   **Suggested Fix:** Modify `getGeohash4Neighbors` and `geohashToHierarchicalPath` to return an empty array (`[]`) or throw a custom, handled error if the input length check fails, allowing callers to handle invalid data without relying on general exception handling.