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

import {
    AgentChatAPI,
    ChatReqMessage,
    ChatRespMessage,
    abortChatRequest,
    getChatMessage
} from "@wso2/ballerina-core";
import { HOST_EXTENSION } from "vscode-messenger-common";
import { Messenger } from "vscode-messenger-webview";

export class AgentChatRpcClient implements AgentChatAPI {
    private _messenger: Messenger;

    constructor(messenger: Messenger) {
        this._messenger = messenger;
    }

    getChatMessage(params: ChatReqMessage): Promise<ChatRespMessage> {
        return this._messenger.sendRequest(getChatMessage, HOST_EXTENSION, params);
    }

    abortChatRequest(): void {
        return this._messenger.sendNotification(abortChatRequest, HOST_EXTENSION);
    }
}
