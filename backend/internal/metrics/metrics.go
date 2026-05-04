package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	RoomsCreated = promauto.NewCounter(prometheus.CounterOpts{
		Name: "frop_rooms_created_total",
		Help: "Total number of rooms created",
	})

	SessionsCreated = promauto.NewCounter(prometheus.CounterOpts{
		Name: "frop_sessions_created_total",
		Help: "Total number of sessions created",
	})

	SessionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "frop_sessions_active",
		Help: "Number of currently active sessions",
	})

	Reconnections = promauto.NewCounter(prometheus.CounterOpts{
		Name: "frop_reconnections_total",
		Help: "Total number of peer reconnections",
	})

	BytesRelayed = promauto.NewCounter(prometheus.CounterOpts{
		Name: "frop_bytes_relayed_total",
		Help: "Total bytes relayed between peers",
	})

	TransfersStarted = promauto.NewCounter(prometheus.CounterOpts{
		Name: "frop_transfers_started_total",
		Help: "Total number of file transfers started",
	})
)
