package main

import (
	"fmt"
	"lido-cli/cmd"
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

	defer cmd.Lido.Shutdown()

	cmd.Execute()

}
