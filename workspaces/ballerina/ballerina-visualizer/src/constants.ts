/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { TRIGGER_CHARACTERS } from '@wso2/ballerina-core';

const completionTriggers = `${TRIGGER_CHARACTERS.map((c) => `\\${c}`).join("")}\(\[`;

export const EXPRESSION_EXTRACTION_REGEX = new RegExp(
    `(?<parentContent>(?:[a-zA-Z0-9_']+[${completionTriggers}])*(?:[a-zA-Z0-9_']+(?<lastCompletionTrigger>[${completionTriggers}])))?(?<currentContent>[a-zA-Z0-9_']*)$`
);
