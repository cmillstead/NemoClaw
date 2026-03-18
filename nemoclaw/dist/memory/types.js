"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MEMORY_CONFIG = exports.PARA_CATEGORIES = void 0;
exports.PARA_CATEGORIES = [
    "projects",
    "areas",
    "resources",
    "archives",
];
exports.DEFAULT_MEMORY_CONFIG = {
    memoryDir: "/sandbox/memory",
    compactionThreshold: 104858, // ~80% of 131072 tokens
    maxAutoPromotedFacts: 5,
    maxAgentFacts: 10,
    maxFactFileSize: 10 * 1024, // 10KB
    maxVolumeSize: 1024 * 1024 * 1024, // 1GB
};
//# sourceMappingURL=types.js.map