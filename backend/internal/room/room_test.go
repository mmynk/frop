package room

import (
	"fmt"
	"testing"
)

func TestGenerateRandomCode(t *testing.T) {
	code := generateRandomCode()
	fmt.Printf("Generated code: %s", code)
	for i := range 3 {
		if !isLetter(code[i]) {
			t.Errorf("Expected %b at index %d to be A-Z", code[i], i)
		}
	}
	for i := 3; i < 6; i++ {
		if !isDigit(code[i]) {
			t.Errorf("Expected %b at index %d to be 0-9", code[i], i)
		}
	}
}

func isLetter(char byte) bool {
	return char >= 'A' && char <= 'Z'
}

func isDigit(char byte) bool {
	return char >= '0' && char <= '9'
}
