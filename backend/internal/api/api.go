package api

import (
	"encoding/json"
	"net/http"
	"pinscout/internal/retailer"
	"regexp"
	"strings"
)

var pinRE = regexp.MustCompile(`^\d{6}$`)

type checkRequest struct {
	URL     string `json:"url"`
	Pincode string `json:"pincode"`
}

func RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/health", withCORS(health))
	mux.HandleFunc("/api/check", withCORS(check))
}

// withCORS handles the browser's automatic CORS preflight (OPTIONS)
// and adds the required response headers for the actual request.
func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "http://localhost:5173"
		}

		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET required"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func check(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}

	var in checkRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	in.URL = strings.TrimSpace(in.URL)
	in.Pincode = strings.TrimSpace(in.Pincode)

	if in.URL == "" || !pinRE.MatchString(in.Pincode) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid product URL and 6-digit pincode required"})
		return
	}

	var rtr retailer.Retailer
	fk := retailer.NewFlipkart()
	if fk.CanHandle(in.URL) {
		rtr = fk
	} else {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "MVP currently supports Flipkart URLs only"})
		return
	}

	product, availability, err := rtr.Check(in.URL, in.Pincode)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"retailer": "flipkart",
		"product": product,
		"availability": availability,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
