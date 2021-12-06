package main

import (
	"fmt"
	"lido-cli/cmd"
	"os"
)

var (
	version  string
	revision string
)

func main() {
	fmt.Printf("lido-cli %s (rev-%s)\n", version, revision)

	// pterm.Success = *pterm.Success.WithPrefix(pterm.Prefix{Text: fmt.Sprint(chalk.Green, "  ✔"), Style: pterm.DefaultBasicText.Style}).WithMessageStyle(&pterm.ThemeDefault.DescriptionMessageStyle)
	// pterm.Error = *pterm.Error.WithPrefix(pterm.Prefix{Text: fmt.Sprint(chalk.Red, "  ✖"), Style: pterm.DefaultBasicText.Style}).WithMessageStyle(&pterm.ThemeDefault.DescriptionMessageStyle)
	// pterm.Info = *pterm.Info.WithPrefix(pterm.Prefix{Text: fmt.Sprint(chalk.Yellow, "  ↓"), Style: pterm.DefaultBasicText.Style}).WithMessageStyle(&pterm.ThemeDefault.DescriptionMessageStyle)

	var networkName = "localhost"
	if os.Getenv("NETWORK_NAME") != "" {
		networkName = os.Getenv("NETWORK_NAME")
	}

	os.Setenv("NETWORK_NAME", networkName)

	defer cmd.Lido.Shutdown()

	cmd.Execute()

}
