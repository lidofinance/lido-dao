package cmd

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"lido-cli/pkg/aragon"
	"lido-cli/pkg/daemon"
	"lido-cli/pkg/deploy"
	"log"
	"os"

	"github.com/pterm/pterm"
	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(startCmd)

	startCmd.AddCommand(startAllCmd)
	startCmd.AddCommand(startForkCmd)
}

var startCmd = &cobra.Command{
	Use:   "start",
	Short: "Start local or form env",
}

var startAllCmd = &cobra.Command{
	Use:   "all",
	Short: "Start hardhat node, start ipfs, deploy contracts, start lido apps, start aragon",
	Run: func(cmd *cobra.Command, args []string) {

		os.Setenv("NETWORK_NAME", Lido.NetworkName)

		Lido.Contracts.Start()
		Lido.HardhatNode.Start("")
		Lido.IPFS.Start()
		if err := Lido.Deploy.Start(); err != nil {
			log.Println(err)
			return
		}
		if err := Lido.LidoApps.Start(); err != nil {
			log.Println(err)
			return
		}
		if err := Lido.AragonClient.Start("", Lido.LidoApps.AppsLocator, nil); err != nil {
			log.Println(err)
			return
		}

		Lido.Deploy.DeployedFile, _ = getDeployedFile(Lido.NetworkName)

		if Lido.AragonClient.RunningUrl != "" && Lido.Deploy.DeployedFile.DaoAddress != "" {
			pterm.Println()
			pterm.FgYellow.Println("Start aragon at: " + Lido.AragonClient.RunningUrl + "/#/" + Lido.Deploy.DeployedFile.DaoAddress)
		}

		daemon.WaitCtrlC()
	},
}

var startForkCmd = &cobra.Command{
	Use:   "fork",
	Short: "Deploy API artifacts",
	Run: func(cmd *cobra.Command, args []string) {

		os.Setenv("NETWORK_NAME", Lido.NetworkName)

		fork, err := cmd.Flags().GetString("fork")
		if err != nil {
			return
		}

		if fork == "" {
			pterm.Error.Println("Please set --fork url")
			return
		}

		Lido.HardhatNode.Start(fork)

		Lido.Deploy.DeployedFile, _ = getDeployedFile(Lido.NetworkName)

		err = Lido.AragonClient.Start(aragon.CMD_MAINNET, Lido.LidoApps.AppsLocator, Lido.Deploy.DeployedFile)
		if err != nil {
			return
		}

		pterm.Println()
		pterm.FgWhite.Println("Start aragon at: " + Lido.AragonClient.RunningUrl + "/#/" + Lido.Deploy.DeployedFile.DaoAddress)

		daemon.WaitCtrlC()
	},
}

func getDeployedFile(networkName string) (*deploy.DeployedFile, error) {

	paths := []string{"./", "../"}
	for _, path := range paths {
		deployedPath := path + fmt.Sprintf("deployed-%s.json", networkName)

		_, err := os.Stat(deployedPath)
		if err != nil {
			continue
		}

		jsonFile, err := os.Open(deployedPath)
		if err != nil {
			return nil, err
		}
		jsonResult, _ := ioutil.ReadAll(jsonFile)

		defer jsonFile.Close()

		var deployedFile deploy.DeployedFile
		json.Unmarshal(jsonResult, &deployedFile)

		return &deployedFile, nil
	}

	return nil, nil
}
