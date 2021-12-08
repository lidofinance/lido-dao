package main

import (
	"lido-cli/cmd"
)

func main() {
	defer cmd.Lido.Shutdown()

	cmd.Execute()
}
