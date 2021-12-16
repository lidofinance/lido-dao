package cmd

import (
	"lido-aragon/pkg/daemon"
	"os"

	"github.com/pterm/pterm"
	"github.com/spf13/cobra"
)

var startNode = &cobra.Command{
	Use:   "node",
	Short: "Start hardhat node only",
	Run: func(cmd *cobra.Command, args []string) {
		os.Setenv("NETWORK_NAME", Lido.NetworkName)
		pterm.Info.Printf("Network: %s\n", Lido.NetworkName)

		fork, err := cmd.Flags().GetString("fork")
		if err != nil {
			return
		}

		if fork == "" {
			pterm.Println("\nYou can set --fork url")
		}

		Lido.HardhatNode.Start(fork)
		daemon.WaitCtrlC()
	},
}
