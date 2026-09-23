.pragma library

// Generated from frontend/app.js by scripts/export-widget-examples.mjs.
var examples = {
  "tone": {
    "model": "jev-latest",
    "state": {
      "context": {
        "conversation": "A short message between two colleagues. Judge only the wording that is present."
      },
      "content": "Could you send me the final document today? I need it before the meeting. Thanks!"
    },
    "questions": {
      "tone": {
        "type": "choice",
        "instructions": "What is the main tone of this message?",
        "criteria": {
          "friendly": "Warm, polite, or appreciative",
          "neutral": "Direct and emotionally neutral",
          "impatient": "Shows frustration or pressure",
          "hostile": "Aggressive or insulting"
        }
      },
      "contains_request": {
        "type": "noul",
        "instructions": "Does the message ask the recipient to do something?"
      }
    }
  },
  "astronomy": {
    "model": "jev-latest",
    "state": {
      "context": {
        "observation_context": "A hobby astronomer is reviewing one observation. Do not assume facts that are not in the measurement.",
        "known_categories": [
          "planet",
          "star",
          "galaxy",
          "comet",
          "instrument artifact",
          "unknown"
        ]
      },
      "content": {
        "object": "HD-219134 b candidate transit",
        "brightness_drop_percent": 0.035,
        "duration_minutes": 58,
        "repeated_after_days": 3.09,
        "telescope": "20 cm backyard telescope",
        "cloud_cover": "low"
      }
    },
    "questions": {
      "most_likely_explanation": {
        "type": "choice",
        "instructions": "What best explains this repeating brightness dip?",
        "criteria": {
          "planet_transit": "An orbiting planet passes in front of the star",
          "variable_star": "The star changes brightness by itself",
          "instrument_artifact": "The detector or processing created the signal",
          "insufficient_data": "The observation cannot distinguish the causes"
        }
      },
      "evidence_strength": {
        "type": "score",
        "instructions": "How strong is this evidence on its own?",
        "criteria": [
          "Very weak",
          "Weak",
          "Moderate",
          "Strong",
          "Very strong"
        ]
      }
    }
  },
  "support": {
    "model": "jev-latest",
    "state": {
      "context": {
        "business_context": "We provide payment software to businesses. Payout failures are handled by Technical Support. Requests blocking next-day operations are urgent.",
        "customer": {
          "tier": "enterprise",
          "region": "Europe"
        },
        "service_rules": {
          "response_sla_hours": 2,
          "production_blocked": true,
          "routing": {
            "payment_connection_failure": "technical",
            "duplicate_charge": "billing"
          }
        }
      },
      "content": "I have tried to connect my payment account for three days. It still fails, and I need payouts working before tomorrow. Please help."
    },
    "questions": {
      "department": {
        "type": "choice",
        "instructions": {
          "task": "Which team should handle this request?",
          "context": "Use our internal ownership rules in the shared business context."
        },
        "criteria": {
          "billing": "Charges, invoices, or refunds",
          "technical": "Bugs or integration failures",
          "sales": "Pricing or purchasing questions",
          "other": "None of these clearly fits"
        }
      },
      "urgency": {
        "type": "score",
        "instructions": {
          "task": "How urgent is this request?",
          "context": "Judge operational impact and deadline, independent of the customer's emotional tone."
        },
        "criteria": [
          "Can wait",
          "Needs attention this week",
          "Needs attention today",
          "Immediate action required"
        ]
      },
      "is_frustrated": {
        "type": "noul",
        "instructions": "Does the customer sound frustrated?",
        "criteria": {
          "true": "The customer expresses frustration or repeated failure",
          "false": "The tone is calm and neutral"
        }
      }
    }
  },
  "purchase": {
    "model": "jev-latest",
    "state": {
      "context": {
        "business_context": "This purchase is for a quiet, energy-efficient homelab.",
        "budget_eur": 300,
        "must_run_24_7": true
      },
      "content": {
        "product": "Used mini PC",
        "price_eur": 240,
        "ram_gb": 32,
        "storage_gb": 1000,
        "use": "24/7 homelab server",
        "condition": "Good, two years old"
      }
    },
    "questions": {
      "recommendation": {
        "type": "choice",
        "instructions": "What is the best purchase decision?",
        "criteria": {
          "buy": "Good value and suitable for the stated use",
          "negotiate": "Suitable, but the price should be lower",
          "skip": "Poor value or unsuitable",
          "need_more_info": "Important facts are missing"
        }
      },
      "value": {
        "type": "score",
        "instructions": "How good is the value for money?",
        "criteria": [
          "Very poor",
          "Poor",
          "Fair",
          "Good",
          "Excellent"
        ]
      },
      "fits_homelab": {
        "type": "noul",
        "instructions": "Is this machine suitable as a 24/7 homelab server?",
        "criteria": {
          "true": "Hardware and condition fit the use",
          "false": "Hardware or condition does not fit the use"
        }
      }
    }
  },
  "news": {
    "model": "jev-latest",
    "state": {
      "context": {
        "reader_context": "The reader follows local and open-source AI, and values reproducible claims over marketing announcements.",
        "reader_interests": [
          "local AI",
          "open-source models",
          "reproducible research"
        ],
        "require_independent_evidence": true
      },
      "content": "A small open-source language model claims benchmark results close to much larger models and can run on a consumer laptop. The release includes model weights and evaluation code."
    },
    "questions": {
      "topic": {
        "type": "choice",
        "instructions": "What is the primary topic?",
        "criteria": {
          "ai_release": "A new AI model or AI product",
          "research": "A scientific result or paper",
          "developer_tool": "Software mainly for developers",
          "other": "None of these"
        }
      },
      "importance": {
        "type": "score",
        "instructions": "How important is this for someone interested in local AI?",
        "criteria": [
          "Irrelevant",
          "Mildly interesting",
          "Useful",
          "Highly important",
          "Essential"
        ]
      },
      "verify_claims": {
        "type": "noul",
        "instructions": "Should the benchmark claims be independently verified before trusting them?"
      }
    }
  },
  "release": {
    "model": "jev-latest",
    "state": {
      "context": {
        "product": {
          "name": "Atlas Notes",
          "users": 42000,
          "critical_workflow": "Users create and synchronize encrypted notes across devices.",
          "availability_target_percent": 99.95
        },
        "release_policy": {
          "blocking_rules": [
            "known data loss",
            "encryption regression",
            "failed rollback test",
            "unresolved critical security issue"
          ],
          "warning_rules": [
            "p95 latency increase above 15%",
            "error budget burn above 10%",
            "missing noncritical documentation"
          ],
          "allowed_rollout": "A staged rollout may start at 5%, then 25%, then 100% if monitoring stays healthy for two hours at each stage."
        },
        "quality_evidence": {
          "automated_tests": {
            "passed": 1842,
            "failed": 2,
            "failure_notes": "Both failures are flaky visual snapshot tests and pass on rerun."
          },
          "security_review": "Completed. No critical or high findings; one medium dependency issue is mitigated at runtime.",
          "rollback_tested": true,
          "load_test": "p95 write latency increased by 11%; error rate stayed below 0.2%."
        },
        "operations": {
          "support_staffed": true,
          "on_call_engineer_available": true,
          "next_safe_window_days": 5
        }
      },
      "content": {
        "version": "4.8.0",
        "changes": [
          "new offline sync engine",
          "faster search index",
          "dependency security updates"
        ],
        "open_bugs": [
          {
            "severity": "medium",
            "description": "Search may briefly show stale results after reconnect"
          },
          {
            "severity": "low",
            "description": "Progress icon occasionally remains visible"
          }
        ],
        "planned_start": "Tuesday 09:00 UTC"
      }
    },
    "questions": {
      "release_decision": {
        "type": "choice",
        "instructions": {
          "task": "What is the safest release decision under the supplied policy?",
          "context": "Treat explicit blocking rules as mandatory. Consider staged rollout when evidence is good but uncertainty remains."
        },
        "criteria": {
          "full_release": "Release to everyone immediately",
          "staged_release": "Start a monitored staged rollout",
          "delay": "Delay until specific concerns are resolved",
          "cancel": "Cancel this release and redesign it"
        }
      },
      "operational_risk": {
        "type": "score",
        "instructions": "How much operational risk remains?",
        "criteria": [
          "Minimal",
          "Low",
          "Moderate",
          "High",
          "Critical"
        ]
      },
      "rollback_ready": {
        "type": "noul",
        "instructions": "Is the team ready to roll back safely if monitoring becomes unhealthy?",
        "criteria": {
          "true": "Rollback was tested and staff can execute it",
          "false": "Rollback ability or staffing is inadequate"
        }
      }
    }
  },
  "research": {
    "model": "jev-latest",
    "state": {
      "context": {
        "study": {
          "objective": "Determine whether a deep-water warming event is real or caused by sensor drift.",
          "location": "North Atlantic monitoring station A17",
          "baseline_years": 12,
          "expected_seasonal_range_c": {
            "minimum": 3.6,
            "maximum": 4.3
          }
        },
        "instrument_network": {
          "primary_sensor": {
            "depth_m": 1800,
            "last_calibrated_days_ago": 410,
            "manufacturer_drift_per_year_c": 0.04
          },
          "reference_sensor": {
            "distance_km": 18,
            "depth_m": 1750,
            "last_calibrated_days_ago": 80
          },
          "satellite_relevance": "Satellite readings measure the surface and cannot directly validate temperature at 1800 metres."
        },
        "quality_rules": {
          "independent_confirmation_required": true,
          "flag_if_change_exceeds_c": 0.15,
          "preferred_checks": [
            "deploy calibrated reference probe",
            "compare nearby moorings",
            "inspect salinity and current changes",
            "review sensor voltage and fouling logs"
          ]
        },
        "environment": {
          "recent_storm": false,
          "current_speed_change_percent": 22,
          "salinity_shift_psu": 0.08
        }
      },
      "content": {
        "observation_window_days": 21,
        "primary_temperature_c": [
          4.18,
          4.26,
          4.31,
          4.39,
          4.43
        ],
        "reference_temperature_c": [
          4.07,
          4.09,
          4.12,
          4.14,
          4.16
        ],
        "primary_sensor_voltage_stable": true,
        "missing_samples_percent": 1.2,
        "technician_note": "Light biological fouling visible during the previous inspection."
      }
    },
    "questions": {
      "leading_explanation": {
        "type": "choice",
        "instructions": {
          "task": "Which explanation is currently best supported?",
          "context": "Distinguish a real environmental signal from instrument error, but allow an uncertain result when independent confirmation is insufficient."
        },
        "criteria": {
          "real_warming": "The water mass has genuinely warmed",
          "sensor_drift": "The primary sensor has drifted upward",
          "mixed_causes": "Environmental change and sensor drift both contribute",
          "undetermined": "The evidence cannot yet distinguish the causes"
        }
      },
      "confidence": {
        "type": "score",
        "instructions": "How strong is the present conclusion?",
        "criteria": [
          "Speculative",
          "Low confidence",
          "Moderate confidence",
          "High confidence",
          "Conclusive"
        ]
      },
      "collect_more_data": {
        "type": "noul",
        "instructions": "Should the team collect independent measurements before publishing a warming claim?",
        "criteria": {
          "true": "The quality rules or current uncertainty require confirmation",
          "false": "Existing evidence is sufficient for the claim"
        }
      }
    }
  },
  "space": {
    "model": "jev-latest",
    "state": {
      "context": {
        "mission": {
          "name": "Asteria-3",
          "objective": "Land an autonomous science package near the lunar south pole and operate for 14 Earth days.",
          "minimum_science_days": 8,
          "crew_onboard": false
        },
        "spacecraft": {
          "battery_state_percent": 87,
          "propellant_margin_percent": 13,
          "navigation": {
            "primary_camera": "healthy",
            "radar_altimeter": "intermittent dropouts below 600 metres",
            "inertial_unit": "healthy"
          },
          "abort_to_orbit_supported": true
        },
        "landing_policy": {
          "maximum_slope_degrees": 12,
          "minimum_illumination_hours": 160,
          "minimum_communication_score": 0.75,
          "hard_blockers": [
            "slope above limit",
            "navigation uncertainty above 100 m",
            "propellant margin below 8%",
            "no abort path"
          ]
        },
        "candidate_sites": [
          {
            "id": "ridge_alpha",
            "slope_deg": 8,
            "illumination_hours": 184,
            "communication_score": 0.82,
            "navigation_uncertainty_m": 74,
            "science_value": "high",
            "boulder_density": "medium"
          },
          {
            "id": "crater_beta",
            "slope_deg": 5,
            "illumination_hours": 142,
            "communication_score": 0.91,
            "navigation_uncertainty_m": 48,
            "science_value": "very high",
            "boulder_density": "low"
          },
          {
            "id": "plain_gamma",
            "slope_deg": 11,
            "illumination_hours": 201,
            "communication_score": 0.71,
            "navigation_uncertainty_m": 62,
            "science_value": "medium",
            "boulder_density": "low"
          }
        ],
        "decision_priority": [
          "safety policy",
          "mission survival",
          "minimum science duration",
          "science value"
        ]
      },
      "content": {
        "phase": "landing site selection",
        "time_to_commit_minutes": 17,
        "orbital_passes_remaining": 2,
        "latest_telemetry": {
          "thermal": "nominal",
          "communications": "stable",
          "radar_dropout_rate_percent": 7
        },
        "flight_team_note": "Radar dropouts are understood and the inertial fallback was verified in simulation, but no live descent test exists."
      }
    },
    "questions": {
      "landing_action": {
        "type": "choice",
        "instructions": {
          "task": "What should the autonomous mission do now?",
          "context": "Apply the landing policy and decision priority in order. A site that violates a hard constraint is not eligible."
        },
        "criteria": {
          "land_ridge_alpha": "Commit to ridge_alpha",
          "land_crater_beta": "Commit to crater_beta",
          "land_plain_gamma": "Commit to plain_gamma",
          "wait_one_orbit": "Use one more orbit to collect data",
          "abort_to_orbit": "Stop descent planning and remain in orbit"
        }
      },
      "mission_risk": {
        "type": "score",
        "instructions": "What is the remaining mission risk if the recommended action is taken?",
        "criteria": [
          "Very low",
          "Low",
          "Moderate",
          "High",
          "Extreme"
        ]
      },
      "policy_compliant": {
        "type": "noul",
        "instructions": "Does the recommended action comply with every hard mission constraint?",
        "criteria": {
          "true": "All hard constraints are satisfied",
          "false": "At least one hard constraint is violated"
        }
      }
    }
  },
  "incident": {
    "model": "jev-latest",
    "state": {
      "context": {
        "role": "Defensive incident triage for a small homelab. Use only the supplied evidence. Do not assert compromise from one weak signal.",
        "environment": {
          "assets": {
            "reverse_proxy": "public",
            "media_server": "private",
            "backup_nas": "private"
          },
          "access": {
            "vpn_required_for_admin": true,
            "geo_blocking": false
          },
          "response_policy": {
            "isolate_on_confirmed_active_compromise": true,
            "preserve_logs_before_reset": true,
            "allow_monitoring_when_uncertain": true
          }
        },
        "evidence_rules": {
          "high_confidence_requires": "Independent corroboration or direct evidence of successful unauthorized access",
          "benign_explanation_must_be_considered": true
        }
      },
      "content": {
        "time_window": "Last 30 minutes",
        "reverse_proxy": {
          "failed_logins": 96,
          "successful_logins": 1,
          "successful_login_source": "usual VPN address",
          "unusual_paths": [
            "/admin",
            "/wp-login.php"
          ]
        },
        "host": {
          "cpu_percent": 42,
          "new_processes": [],
          "outbound_destinations": [
            "configured backup target"
          ],
          "file_integrity_alerts": 0
        },
        "notes": "The failed logins came from rotating public IPs. The only success used a known account through the expected VPN address. No change was found on the private NAS."
      }
    },
    "questions": {
      "incident_classification": {
        "type": "choice",
        "instructions": {
          "task": "What is the best current classification?",
          "context": "Separate attempted access from successful compromise; allow uncertainty."
        },
        "criteria": {
          "routine_noise": "Expected background scanning with no targeted pattern",
          "attempted_intrusion": "Suspicious access attempts without evidence of success",
          "likely_compromise": "Independent evidence points to unauthorized access",
          "insufficient_evidence": "Available evidence cannot distinguish these states"
        }
      },
      "response_priority": {
        "type": "score",
        "instructions": "Rate response priority using the supplied asset exposure and evidence.",
        "criteria": [
          "Monitor",
          "Investigate today",
          "Urgent investigation",
          "Immediate containment"
        ]
      },
      "isolate_reverse_proxy_now": {
        "type": "noul",
        "instructions": {
          "task": "Should the reverse proxy be isolated immediately?",
          "context": "Apply the response policy and consider service disruption and preservation of logs."
        },
        "criteria": {
          "true": "Evidence justifies immediate isolation",
          "false": "Continue investigation or monitoring without immediate isolation"
        }
      }
    }
  },
  "devsecops": {
    "model": "jev-latest",
    "state": {
      "context": {
        "role": "Defensive release review. Decide whether a small team can ship a web service update.",
        "release_policy": {
          "hard_blocks": {
            "exploited_vulnerability_in_runtime": true,
            "unsigned_production_artifact": true,
            "failing_authz_regression": true
          },
          "conditional_release": {
            "medium_finding_requires_owner_and_deadline": true,
            "staged_rollout_required_when_dependency_change_is_large": true
          },
          "review_order": [
            "hard blocks",
            "test evidence",
            "mitigations",
            "rollout readiness"
          ]
        },
        "deployment": {
          "audience": "public internet",
          "data": "user profiles; no payment data",
          "rollback_minutes": 10
        }
      },
      "content": {
        "change": "Upgrade the API framework and rebuild the container image",
        "artifact": {
          "signed": true,
          "provenance_attested": true,
          "sbom_generated": true
        },
        "scans": {
          "critical": 0,
          "high": 0,
          "medium": 2,
          "exploited_runtime_vulnerability": false
        },
        "tests": {
          "unit": "pass",
          "integration": "pass",
          "authorization_regression": "pass",
          "dynamic_scan": "pass"
        },
        "exceptions": [
          {
            "finding": "Medium severity transitive dependency",
            "owner": "platform team",
            "deadline_days": 14,
            "compensating_control": "affected feature disabled"
          }
        ],
        "rollout": {
          "staged_percent": 10,
          "monitoring_minutes": 60,
          "rollback_drill_completed": true
        },
        "uncertainty": "The second medium finding has no assigned owner or due date."
      }
    },
    "questions": {
      "release_decision": {
        "type": "choice",
        "instructions": {
          "task": "Choose the release disposition under the stated policy.",
          "context": "Check hard blocks first, then conditional requirements. Treat missing ownership as meaningful."
        },
        "criteria": {
          "approve": "Ship normally now",
          "approve_with_conditions": "Ship only after explicit conditions are met",
          "hold": "Do not ship until gaps are fixed",
          "escalate": "Policy is insufficient and an authorized exception is required"
        }
      },
      "residual_risk": {
        "type": "score",
        "instructions": "Rate residual release risk after current controls, not the unmitigated scanner severity.",
        "criteria": [
          "Very low",
          "Low",
          "Moderate",
          "High",
          "Critical"
        ]
      },
      "policy_ready": {
        "type": "noul",
        "instructions": "Does the release currently satisfy every stated mandatory and conditional policy requirement?",
        "criteria": {
          "true": "All requirements are met",
          "false": "At least one requirement remains unmet"
        }
      }
    }
  }
}

var descriptions = {
  "tone": "A quick language test: identify the tone of a colleague’s message and whether it contains a request. Use only the words shown; do not invent the sender’s intent.",
  "astronomy": "Assess a repeating dip in a star’s brightness. Compare a possible planet transit with stellar variation and instrument error, then rate how strong one small-telescope observation really is.",
  "purchase": "Decide whether a used mini PC fits a 24/7 homelab and a €300 budget. Separate suitability from value for money, and allow “need more information” when essential details are missing.",
  "news": "Classify an AI model announcement for a reader interested in local, open-source AI. Weigh its relevance while treating unverified benchmark claims cautiously.",
  "support": "Route a payment-software support message to the right team, rate its urgency, and judge frustration. Apply the shared service rules instead of relying only on the message’s tone.",
  "release": "Review a software release using nested product, quality, and operations context. Decide between a full release, staged rollout, delay, or cancellation under explicit blocking rules.",
  "research": "Evaluate a deep-water warming signal against possible sensor drift. Compare independent measurements, calibration history, and quality rules before deciding whether the claim is ready to publish.",
  "space": "Choose an action for an autonomous lunar lander with limited time and uncertain radar data. Apply hard landing constraints before comparing science value and mission risk.",
  "incident": "Triage suspicious homelab login activity without assuming a breach. Distinguish attempted access from confirmed compromise and choose a response that follows the evidence and isolation policy.",
  "devsecops": "Review a public web-service release gate. Check hard blockers, artifact evidence, test results, open findings, ownership, and rollout controls before deciding whether to ship."
}

function names() { return Object.keys(examples) }
function get(name) { return examples[name] || examples.tone }
function description(name) { return descriptions[name] || "" }
