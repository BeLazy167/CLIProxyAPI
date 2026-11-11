package rpc

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var emailAddress = regexp.MustCompile(`[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}`)

// Failure 20: the plugin folder (code, tests, fixtures, docs, reports) holds a real email address. Only the
// reserved example domains may appear; the recipient and sender come from the config.
func TestNoRealEmailAddressInPlugin(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "bin" || strings.HasPrefix(d.Name(), ".")) && path != root {
			return filepath.SkipDir
		}
		if d.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil || bytes.IndexByte(raw, 0) >= 0 {
			return err
		}
		for _, addr := range emailAddress.FindAllString(string(raw), -1) {
			domain := strings.TrimSuffix(strings.ToLower(addr[strings.LastIndex(addr, "@")+1:]), ".json") // auth file names
			if domain != "example.com" && domain != "example.org" && domain != "example.net" {
				rel, _ := filepath.Rel(root, path)
				t.Errorf("%s holds the email address %s", rel, addr)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
