package offers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

// The state file is shared with the Python service, which writes it with json.dump(indent=1, sort_keys=True)
// and reads JSON numbers as Python int or float. These helpers write the bytes Python writes and format
// values the way Python's str(), repr() and isoformat() do, so dedupe keys, messages and files match.

// encodePy writes v as Python's json.dumps(v, indent=1, sort_keys=True) does.
func encodePy(v any) []byte {
	var b bytes.Buffer
	writePy(&b, v, 0)
	return b.Bytes()
}

func writePy(b *bytes.Buffer, v any, level int) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case string:
		b.WriteString(quotePy(x))
	case json.Number:
		b.WriteString(numberPy(x))
	case int:
		b.WriteString(strconv.Itoa(x))
	case float64:
		b.WriteString(floatJSON(x))
	case Offer:
		writePy(b, map[string]any(x), level)
	case map[string]any:
		if len(x) == 0 {
			b.WriteString("{}")
			return
		}
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteString("{")
		for i, k := range keys {
			newline(b, level+1)
			b.WriteString(quotePy(k))
			b.WriteString(": ")
			writePy(b, x[k], level+1)
			if i < len(keys)-1 {
				b.WriteString(",")
			}
		}
		newline(b, level)
		b.WriteString("}")
	case []string:
		items := make([]any, len(x))
		for i, s := range x {
			items[i] = s
		}
		writePy(b, items, level)
	case []any:
		if len(x) == 0 {
			b.WriteString("[]")
			return
		}
		b.WriteString("[")
		for i, item := range x {
			newline(b, level+1)
			writePy(b, item, level+1)
			if i < len(x)-1 {
				b.WriteString(",")
			}
		}
		newline(b, level)
		b.WriteString("]")
	default:
		panic(fmt.Sprintf("offers: no Python JSON form for %T", v))
	}
}

func newline(b *bytes.Buffer, level int) {
	b.WriteString("\n")
	b.WriteString(strings.Repeat(" ", level))
}

// quotePy escapes like Python's json with ensure_ascii: everything outside space to tilde becomes \uXXXX.
func quotePy(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			switch {
			case r >= ' ' && r <= '~':
				b.WriteRune(r)
			case r > 0xFFFF:
				hi, lo := utf16.EncodeRune(r)
				fmt.Fprintf(&b, `\u%04x\u%04x`, hi, lo)
			default:
				fmt.Fprintf(&b, `\u%04x`, r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// numberPy writes a JSON number as Python writes the int or float it parsed it into.
func numberPy(n json.Number) string {
	s := string(n)
	if !strings.ContainsAny(s, ".eE") {
		if s == "-0" {
			return "0"
		}
		return s
	}
	f, _ := strconv.ParseFloat(s, 64)
	return floatJSON(f)
}

func floatJSON(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	}
	return reprFloat(f)
}

// reprFloat is Python's repr(float): the shortest round-trip digits, fixed notation for exponents
// from -4 to 15, a trailing ".0" on whole numbers, and e+XX / e-XX otherwise.
func reprFloat(f float64) string {
	switch {
	case math.IsNaN(f):
		return "nan"
	case math.IsInf(f, 1):
		return "inf"
	case math.IsInf(f, -1):
		return "-inf"
	}
	sign := ""
	if math.Signbit(f) {
		sign, f = "-", -f
	}
	if f == 0 {
		return sign + "0.0"
	}
	e := strconv.FormatFloat(f, 'e', -1, 64)
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	x, _ := strconv.Atoi(exp)
	decpt := x + 1
	if decpt <= -4 || decpt > 16 {
		out := digits[:1]
		if len(digits) > 1 {
			out += "." + digits[1:]
		}
		es := "+"
		if x < 0 {
			es, x = "-", -x
		}
		return fmt.Sprintf("%s%se%s%02d", sign, out, es, x)
	}
	switch {
	case decpt <= 0:
		return sign + "0." + strings.Repeat("0", -decpt) + digits
	case decpt >= len(digits):
		return sign + digits + strings.Repeat("0", decpt-len(digits)) + ".0"
	default:
		return sign + digits[:decpt] + "." + digits[decpt:]
	}
}

// strPy is Python's str() of a JSON value, as f-strings print it.
func strPy(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return reprPy(v)
}

// reprPy is Python's repr() of a JSON value. Dict keys come out sorted; Python keeps document order.
func reprPy(v any) string {
	switch x := v.(type) {
	case nil:
		return "None"
	case bool:
		if x {
			return "True"
		}
		return "False"
	case string:
		return quoteRepr(x)
	case json.Number:
		if !strings.ContainsAny(string(x), ".eE") {
			return numberPy(x)
		}
		f, _ := strconv.ParseFloat(string(x), 64)
		return reprFloat(f)
	case int:
		return strconv.Itoa(x)
	case float64:
		return reprFloat(x)
	case []string:
		parts := make([]string, len(x))
		for i, s := range x {
			parts[i] = quoteRepr(s)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			parts[i] = reprPy(item)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = quoteRepr(k) + ": " + reprPy(x[k])
		}
		return "{" + strings.Join(parts, ", ") + "}"
	}
	return fmt.Sprint(v)
}

func quoteRepr(s string) string {
	q := byte('\'')
	if strings.ContainsRune(s, '\'') && !strings.ContainsRune(s, '"') {
		q = '"'
	}
	var b strings.Builder
	b.WriteByte(q)
	for _, r := range s {
		switch {
		case r == '\\' || r == rune(q):
			b.WriteByte('\\')
			b.WriteRune(r)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < ' ' || r == 0x7f:
			fmt.Fprintf(&b, `\x%02x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte(q)
	return b.String()
}

// isoformat is Python's datetime.isoformat() for an aware time: microseconds only when not zero.
func isoformat(t time.Time) string {
	s := t.Format("2006-01-02T15:04:05")
	if us := t.Nanosecond() / 1000; us != 0 {
		s += fmt.Sprintf(".%06d", us)
	}
	_, off := t.Zone()
	sign := "+"
	if off < 0 {
		sign, off = "-", -off
	}
	s += fmt.Sprintf("%s%02d:%02d", sign, off/3600, off%3600/60)
	if off%60 != 0 {
		s += fmt.Sprintf(":%02d", off%60)
	}
	return s
}

// parseTime is decide.parse_time: an ISO time with an offset, fractions cut to microseconds.
func parseTime(v any) (time.Time, bool) {
	s, ok := v.(string)
	if !ok || s == "" {
		return time.Time{}, false
	}
	if len(s) > 10 && s[10] == ' ' {
		s = s[:10] + "T" + s[11:]
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}, false
	}
	return t.Truncate(time.Microsecond), true
}

// strftime formats "%b %d %H:%M" in the time's own offset, as the Python messages do.
func strftime(t time.Time) string {
	return t.Format("Jan 02 15:04")
}
