/**
 * Extracts a potentially nested value from an object using a dot-notation path.
 * @param obj The object to extract the value from.
 * @param path A string representing the path (e.g., 'data.user.id').
 * @returns The extracted value, or undefined if the path is invalid or the value doesn't exist.
 */
export function extractValueFromJson(obj: any, path: string): any {
    if (!path) return undefined;
    // Basic dot notation split, improve if complex paths needed (e.g., array indices)
    const keys = path.split('.'); 
    let current = obj;
    for (const key of keys) {
        if (current === null || current === undefined || typeof current !== 'object') return undefined;
        current = current[key];
    }
    return current;
} 