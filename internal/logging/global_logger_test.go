package logging

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	log "github.com/sirupsen/logrus"
)

func setStdoutForTest(w io.Writer) func() {
	writerMu.Lock()
	defer writerMu.Unlock()
	prev := stdoutWriter
	stdoutWriter = w
	return func() {
		writerMu.Lock()
		defer writerMu.Unlock()
		stdoutWriter = prev
	}
}

func TestLogFormatterPrintsVersionField(t *testing.T) {
	entry := log.NewEntry(log.New())
	entry.Time = time.Date(2026, 6, 9, 11, 10, 2, 0, time.Local)
	entry.Level = log.InfoLevel
	entry.Message = "fetched latest antigravity version"
	entry.Data["version"] = "2.1.0"

	formatted, errFormat := (&LogFormatter{}).Format(entry)
	if errFormat != nil {
		t.Fatalf("Format() error = %v", errFormat)
	}

	line := string(formatted)
	if !strings.Contains(line, "version=2.1.0") {
		t.Fatalf("formatted line %q missing version field", line)
	}
}

func TestLogFormatterPrintsMediaForwardingFields(t *testing.T) {
	entry := log.NewEntry(log.New())
	entry.Time = time.Date(2026, 7, 25, 7, 36, 4, 0, time.Local)
	entry.Level = log.InfoLevel
	entry.Message = "codex live remote media forwarding started"
	entry.Data["credential"] = "Voice credential\nsecondary"
	entry.Data["connection"] = "via socks5 proxy"
	entry.Data["proxy_scheme"] = "socks5"
	entry.Data["remote_transport"] = "tcp"
	entry.Data["media_session_id"] = "media-session-id"
	entry.Data["call_id"] = "call-id"
	entry.Data["peer"] = "remote"
	entry.Data["state"] = "connected"

	formatted, errFormat := (&LogFormatter{}).Format(entry)
	if errFormat != nil {
		t.Fatalf("Format() error = %v", errFormat)
	}

	line := string(formatted)
	for _, want := range []string{
		`credential="Voice credential\nsecondary"`,
		`connection="via socks5 proxy"`,
		`proxy_scheme="socks5"`,
		`remote_transport="tcp"`,
		`media_session_id="media-session-id"`,
		`call_id="call-id"`,
		`peer="remote"`,
		`state="connected"`,
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("formatted line %q missing %s", line, want)
		}
	}
	if strings.Count(line, "\n") != 1 {
		t.Fatalf("formatted line contains an unescaped newline: %q", line)
	}
}

func TestLogFormatterPrintsPluginFields(t *testing.T) {
	entry := log.NewEntry(log.New())
	entry.Time = time.Date(2026, 6, 25, 20, 10, 0, 0, time.Local)
	entry.Level = log.InfoLevel
	entry.Message = "pluginhost: plugin loaded"
	entry.Data["plugin_id"] = "sample-provider"
	entry.Data["plugin_name"] = "Sample Provider"
	entry.Data["version"] = "0.2.0"
	entry.Data["active_version"] = "0.1.0"
	entry.Data["retired_version"] = "0.2.0"
	entry.Data["path"] = "plugins/windows/amd64/sample-provider-v0.2.0.dll"
	entry.Data["active_path"] = "plugins/windows/amd64/sample-provider-v0.1.0.dll"
	entry.Data["retired_path"] = "plugins/windows/amd64/sample-provider-v0.2.0.dll"

	formatted, errFormat := (&LogFormatter{}).Format(entry)
	if errFormat != nil {
		t.Fatalf("Format() error = %v", errFormat)
	}

	line := string(formatted)
	for _, want := range []string{
		"plugin_id=sample-provider",
		"plugin_name=Sample Provider",
		"version=0.2.0",
		"active_version=0.1.0",
		"retired_version=0.2.0",
		"path=plugins/windows/amd64/sample-provider-v0.2.0.dll",
		"active_path=plugins/windows/amd64/sample-provider-v0.1.0.dll",
		"retired_path=plugins/windows/amd64/sample-provider-v0.2.0.dll",
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("formatted line %q missing %s", line, want)
		}
	}
}

func TestLogFormatterOmitsGenericPathField(t *testing.T) {
	entry := log.NewEntry(log.New())
	entry.Time = time.Date(2026, 6, 25, 20, 20, 0, 0, time.Local)
	entry.Level = log.WarnLevel
	entry.Message = "failed to roll back token"
	entry.Data["path"] = "auths/private-token.json"
	entry.Data["active_path"] = "plugins/windows/amd64/sample-provider-v0.1.0.dll"
	entry.Data["retired_path"] = "plugins/windows/amd64/sample-provider-v0.2.0.dll"

	formatted, errFormat := (&LogFormatter{}).Format(entry)
	if errFormat != nil {
		t.Fatalf("Format() error = %v", errFormat)
	}

	line := string(formatted)
	for _, forbidden := range []string{"path=", "active_path=", "retired_path="} {
		if strings.Contains(line, forbidden) {
			t.Fatalf("formatted line %q contains generic %s field", line, forbidden)
		}
	}
}

func TestConfigureLogOutput_FileLoggingKeepsStdout(t *testing.T) {
	writable := t.TempDir()
	t.Setenv("WRITABLE_PATH", writable)
	mainLog := filepath.Join(writable, "logs", "main.log")
	cfg := &config.Config{LoggingToFile: true, AuthDir: t.TempDir()}

	var stdout bytes.Buffer
	t.Cleanup(setStdoutForTest(&stdout))
	origOut := log.StandardLogger().Out
	t.Cleanup(func() {
		closeLogOutputs()
		log.SetOutput(origOut)
	})
	readFile := func() string {
		data, err := os.ReadFile(mainLog)
		if err != nil {
			t.Fatalf("read main.log: %v", err)
		}
		return string(data)
	}

	if err := ConfigureLogOutput(cfg); err != nil {
		t.Fatalf("ConfigureLogOutput(LoggingToFile=true) error = %v", err)
	}
	log.Info("first-line")
	if got := strings.Count(stdout.String(), "first-line"); got != 1 {
		t.Fatalf("stdout has first-line %d times, want 1: %q", got, stdout.String())
	}
	if got := strings.Count(readFile(), "first-line"); got != 1 {
		t.Fatalf("main.log has first-line %d times, want 1", got)
	}

	if err := ConfigureLogOutput(cfg); err != nil {
		t.Fatalf("second ConfigureLogOutput(LoggingToFile=true) error = %v", err)
	}
	log.Info("after-reload")
	if got := strings.Count(stdout.String(), "after-reload"); got != 1 {
		t.Fatalf("stdout has after-reload %d times after a reload, want 1", got)
	}
	if got := strings.Count(readFile(), "after-reload"); got != 1 {
		t.Fatalf("main.log has after-reload %d times after a reload, want 1", got)
	}

	if _, _, err := config.NormalizeConfigLayout([]byte("some-unknown-section:\n  foo: bar\n"), true); err != nil {
		t.Fatalf("NormalizeConfigLayout() error = %v", err)
	}
	if got := strings.Count(stdout.String(), "some-unknown-section"); got != 1 {
		t.Fatalf("stdout has the migration warning %d times, want 1: %q", got, stdout.String())
	}

	cfg.LoggingToFile = false
	if err := ConfigureLogOutput(cfg); err != nil {
		t.Fatalf("ConfigureLogOutput(LoggingToFile=false) error = %v", err)
	}
	log.Info("stdout-only")
	if !strings.Contains(stdout.String(), "stdout-only") {
		t.Fatalf("stdout lost stdout-only after file logging was turned off")
	}
	if strings.Contains(readFile(), "stdout-only") {
		t.Fatalf("main.log still receives lines after file logging was turned off")
	}
}

func TestConfigureLogOutput_ConcurrentMigration(t *testing.T) {
	tempDir := t.TempDir()
	cfgFile := &config.Config{
		LoggingToFile: true,
		AuthDir:       tempDir,
	}
	cfgStdout := &config.Config{
		LoggingToFile: false,
		AuthDir:       tempDir,
	}

	origOut := log.StandardLogger().Out
	t.Cleanup(func() {
		closeLogOutputs()
		log.SetOutput(origOut)
	})

	t.Setenv("WRITABLE_PATH", t.TempDir())
	t.Cleanup(setStdoutForTest(io.Discard))

	raw := []byte("some-unknown-section:\n  foo: bar\n")
	var wg sync.WaitGroup
	var errOnce sync.Once
	var firstErr error
	recordErr := func(err error) {
		if err != nil {
			errOnce.Do(func() { firstErr = err })
		}
	}
	for i := 0; i < 20; i++ {
		wg.Add(3)
		go func(iteration int) {
			defer wg.Done()
			var err error
			if iteration%2 == 0 {
				err = ConfigureLogOutput(cfgFile)
			} else {
				err = ConfigureLogOutput(cfgStdout)
			}
			recordErr(err)
		}(i)
		go func() {
			defer wg.Done()
			_, _, err := config.NormalizeConfigLayout(raw, true)
			recordErr(err)
		}()
		go func() {
			defer wg.Done()
			_, _, err := config.NormalizeConfigLayout(raw, true)
			recordErr(err)
		}()
	}
	wg.Wait()
	if firstErr != nil {
		t.Fatalf("concurrent migration/log output switch encountered error: %v", firstErr)
	}
}

func TestLogFormatterFormatsShortRequestID(t *testing.T) {
	formatter := &LogFormatter{}

	// Test case 1: UUID v7 full string truncated to trailing 8 chars in console log
	entryUUID := log.NewEntry(log.New())
	entryUUID.Time = time.Date(2026, 9, 28, 12, 0, 0, 0, time.Local)
	entryUUID.Level = log.InfoLevel
	entryUUID.Message = "handling request"
	entryUUID.Data["request_id"] = "018f3a5b-1234-7abc-def0-12345678abcd"

	formattedUUID, errFormatUUID := formatter.Format(entryUUID)
	if errFormatUUID != nil {
		t.Fatalf("Format() error = %v", errFormatUUID)
	}
	lineUUID := string(formattedUUID)
	if !strings.Contains(lineUUID, "[5678abcd]") {
		t.Fatalf("formatted line %q does not contain expected short request ID [5678abcd]", lineUUID)
	}
	if strings.Contains(lineUUID, "018f3a5b-1234-7abc-def0-12345678abcd") {
		t.Fatalf("formatted line %q should not contain full UUID", lineUUID)
	}

	// Test case 2: legacy or short 8-char request ID preserved
	entryShort := log.NewEntry(log.New())
	entryShort.Time = time.Date(2026, 9, 28, 12, 0, 0, 0, time.Local)
	entryShort.Level = log.InfoLevel
	entryShort.Message = "handling short id request"
	entryShort.Data["request_id"] = "00000042"

	formattedShort, errFormatShort := formatter.Format(entryShort)
	if errFormatShort != nil {
		t.Fatalf("Format() error = %v", errFormatShort)
	}
	lineShort := string(formattedShort)
	if !strings.Contains(lineShort, "[00000042]") {
		t.Fatalf("formatted line %q does not contain expected request ID [00000042]", lineShort)
	}

	// Test case 3: omitted request ID formats placeholder
	entryEmpty := log.NewEntry(log.New())
	entryEmpty.Time = time.Date(2026, 9, 28, 12, 0, 0, 0, time.Local)
	entryEmpty.Level = log.InfoLevel
	entryEmpty.Message = "system event"

	formattedEmpty, errFormatEmpty := formatter.Format(entryEmpty)
	if errFormatEmpty != nil {
		t.Fatalf("Format() error = %v", errFormatEmpty)
	}
	lineEmpty := string(formattedEmpty)
	if !strings.Contains(lineEmpty, "[--------]") {
		t.Fatalf("formatted line %q does not contain expected placeholder [--------]", lineEmpty)
	}
}
