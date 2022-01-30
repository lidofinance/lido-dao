package main

import (
	"lido-aragon/cmd"
)

func main() {
	defer cmd.Lido.Shutdown()

	cmd.Execute()
}
