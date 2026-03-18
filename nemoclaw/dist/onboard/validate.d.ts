export interface ValidationResult {
    valid: boolean;
    models: string[];
    error: string | null;
}
export declare function validateApiKey(apiKey: string, endpointUrl: string): Promise<ValidationResult>;
export declare function maskApiKey(apiKey: string): string;
/**
 * Check if an API key matches any of the expected prefixes for a provider.
 * Returns null if valid (or no prefixes defined), or an error string.
 */
export declare function validateKeyPrefix(apiKey: string, prefixes: string[] | undefined): string | null;
/**
 * Lightweight reachability check -- HEAD request to the endpoint's /models.
 * Returns { reachable: true } or { reachable: false, error: string }.
 * Any HTTP response (even 401/403) counts as reachable.
 */
export declare function validateEndpointReachable(endpointUrl: string): Promise<{
    reachable: boolean;
    error?: string;
}>;
//# sourceMappingURL=validate.d.ts.map