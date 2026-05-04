package main

import (
	"net"
	"net/http"
	"os"
	"strings"
)

// flyNetworkOnly restricts the handler to Fly.io's private IPv6 network (fdaa::/7).
// The managed Prometheus scraper runs inside this network, so Grafana works.
// All external requests return 403.
// In local dev (APP_ENV != production), all requests are allowed.
// Admins can also authenticate via "Authorization: Bearer <token>" using METRICS_TOKEN.
func flyNetworkOnly(adminToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("APP_ENV") == "production" {
			ip, _, _ := net.SplitHostPort(r.RemoteAddr)
			if strings.HasPrefix(ip, "fdaa") || ip == "127.0.0.1" || ip == "::1" {
				next.ServeHTTP(w, r)
				return
			}
			if adminToken != "" && r.Header.Get("Authorization") == "Bearer "+adminToken {
				next.ServeHTTP(w, r)
				return
			}
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
