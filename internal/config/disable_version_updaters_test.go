package config

import (
	"strings"
	"testing"
)

func TestDisableVersionUpdatersLayouts(t *testing.T) {
	for name, raw := range map[string]string{
		"legacy": "disable-version-updaters: true\n",
		"v8":     "config-version: 8\nrequests:\n  disable-version-updaters: true\n",
	} {
		t.Run(name, func(t *testing.T) {
			cfg, errParse := ParseConfigBytes([]byte(raw))
			if errParse != nil {
				t.Fatalf("ParseConfigBytes() error = %v", errParse)
			}
			if !cfg.DisableVersionUpdaters {
				t.Fatal("DisableVersionUpdaters = false, want true")
			}
		})
	}

	cfg, errParse := ParseConfigBytes([]byte("port: 8317\n"))
	if errParse != nil {
		t.Fatalf("ParseConfigBytes() error = %v", errParse)
	}
	if cfg.DisableVersionUpdaters {
		t.Fatal("DisableVersionUpdaters defaults to true, want false")
	}
}

func TestDisableVersionUpdatersSurvivesV8Migration(t *testing.T) {
	migrated, changed, errMigrate := NormalizeConfigLayout([]byte("port: 8317\ndisable-version-updaters: true\n"), true)
	if errMigrate != nil || !changed {
		t.Fatalf("migrate legacy file: changed=%v error=%v", changed, errMigrate)
	}
	if strings.Contains(string(migrated), "# disable-version-updaters") {
		t.Fatalf("migration commented the key out:\n%s", migrated)
	}
	if errValidate := ValidateV8Config(migrated); errValidate != nil {
		t.Fatalf("migrated file is invalid: %v", errValidate)
	}
	cfg, errParse := ParseConfigBytes(migrated)
	if errParse != nil {
		t.Fatalf("ParseConfigBytes(migrated) error = %v", errParse)
	}
	if !cfg.DisableVersionUpdaters {
		t.Fatalf("migration lost disable-version-updaters:\n%s", migrated)
	}
}
