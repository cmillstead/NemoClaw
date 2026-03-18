import type { EndpointType } from "./config.js";
export interface ProviderDefinition {
    id: EndpointType;
    label: string;
    hint: string | ((ctx: {
        ollamaInstalled: boolean;
    }) => string);
    profile: string;
    providerName: string;
    credentialEnv: string;
    requiresApiKey: boolean;
    defaultCredential: string;
    endpointUrlMode: "fixed" | "prompt" | "prompt-with-default";
    defaultEndpointUrl: string | null;
    endpointUrlPrompt?: string;
    requiresNcpPartner: boolean;
    tier: "supported" | "local" | "custom";
    softValidation: boolean;
    keyPrefixes?: string[];
}
export declare const PROVIDERS: ProviderDefinition[];
/** Lookup a provider definition by id. Throws if not found. */
export declare function getProvider(id: EndpointType): ProviderDefinition;
/** All valid endpoint type strings. */
export declare const ENDPOINT_TYPES: EndpointType[];
//# sourceMappingURL=providers.d.ts.map