package main

import (
	"log"
	"net/http"
	"pinscout/internal/api"
)

func main() {
	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	log.Println("PinScout API listening on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
