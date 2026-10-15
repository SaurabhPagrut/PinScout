package retailer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Flipkart struct {
	Client *http.Client
}

func NewFlipkart() *Flipkart {
	return &Flipkart{Client: &http.Client{Timeout: 20 * time.Second}}
}

func (f *Flipkart) CanHandle(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && strings.EqualFold(u.Hostname(), "www.flipkart.com")
}

func pageURI(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Path == "" || u.Path == "/" {
		return "", fmt.Errorf("invalid Flipkart product URL")
	}
	return u.EscapedPath(), nil
}

func (f *Flipkart) Check(rawURL, pincode string) (*Product, *Availability, error) {
	page, err := pageURI(rawURL)
	if err != nil {
		return nil, nil, err
	}

	body, _ := json.Marshal(map[string]any{
		"pageUri": page,
		"locationContext": map[string]string{"pincode": pincode},
	})

	req, err := http.NewRequest(http.MethodPost,
		"https://1.rome.api.flipkart.com/api/4/page/fetch",
		bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := f.Client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("Flipkart returned HTTP %d", resp.StatusCode)
	}

	// Flipkart's response is large and its exact schema can change.
	// For the first MVP we recursively inspect JSON for the fields
	// documented by the current open-source implementation.
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, nil, fmt.Errorf("invalid JSON from Flipkart")
	}

	serviceable, foundServiceable := findBool(root, "serviceable")
	availabilityStatus, _ := findString(root, "availabilityStatus")
	slaText, _ := findString(root, "slaText")
	title, _ := findString(root, "title")

	if !foundServiceable {
		return nil, nil, fmt.Errorf("serviceability field not found; Flipkart response may have changed")
	}

	return &Product{Title: title, URL: rawURL}, &Availability{
		Pincode: pincode,
		Serviceable: serviceable,
		Availability: availabilityStatus,
		SLAText: slaText,
		RawStatus: availabilityStatus,
	}, nil
}

func findBool(v any, key string) (bool, bool) {
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			if k == key {
				if b, ok := val.(bool); ok {
					return b, true
				}
			}
			if b, ok := findBool(val, key); ok {
				return b, ok
			}
		}
	case []any:
		for _, val := range x {
			if b, ok := findBool(val, key); ok {
				return b, ok
			}
		}
	}
	return false, false
}

func findString(v any, key string) (string, bool) {
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			if k == key {
				if s, ok := val.(string); ok {
					return s, true
				}
			}
			if s, ok := findString(val, key); ok {
				return s, ok
			}
		}
	case []any:
		for _, val := range x {
			if s, ok := findString(val, key); ok {
				return s, ok
			}
		}
	}
	return "", false
}
