package retailer

type Product struct {
	Title string `json:"title,omitempty"`
	URL   string `json:"url"`
}

type Availability struct {
	Pincode       string `json:"pincode"`
	Serviceable   bool   `json:"serviceable"`
	Availability  string `json:"availability,omitempty"`
	SLAText       string `json:"sla_text,omitempty"`
	RawStatus     string `json:"raw_status,omitempty"`
}

type Retailer interface {
	CanHandle(url string) bool
	Check(url, pincode string) (*Product, *Availability, error)
}
