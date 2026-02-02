package models

type WsRequest struct {
	Type string `json:"type"`
	Code string `json:"code"`
}

type WsResponse struct {
	Type string `json:"type"`
}
