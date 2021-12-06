package aragon

import (
	"bytes"
	"errors"
	"fmt"
	"lido-cli/pkg/deploy"
	"lido-cli/pkg/logs"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/pterm/pterm"
)

var (
	CMD_LOCAL   AragonNetwork = "local"
	CMD_MAINNET AragonNetwork = "mainnet"
	CMD_RINKEBY AragonNetwork = "rinkeby"
	CMD_STAGING AragonNetwork = "staging"
	CMD_ROPSTEN AragonNetwork = "ropsten"
	CMD_XDAI    AragonNetwork = "xdai"
)

type AragonNetwork string

type AragonClient struct {
	Cmd  *exec.Cmd
	Outb bytes.Buffer
	Errb bytes.Buffer

	RunningUrl string
}

func checkApp(name string, address string, appInfo deploy.AppInfo, appLocatorArr *[]string) {
	if name != appInfo.Name {
		return
	}

	var appId string
	var appAddress string

	//check name
	if strings.HasPrefix(name, "0x") {
		appId = name
	} else if appInfo.ID != "" {
		appId = appInfo.ID
	}

	//check address
	if strings.Contains(address, "http://") || strings.Contains(address, "https://") {
		appAddress = address

		//check fo IPFS CID v0 - https://docs.ipfs.io/concepts/content-addressing/#identifier-formats
	} else if strings.HasPrefix(address, "Qm") && len(address) == 46 {
		//@todo load from flags
		appAddress = "https://mainnet.lido.fi/ipfs/" + address
	}

	*appLocatorArr = append(*appLocatorArr, fmt.Sprintf("%s:%s", appId, appAddress))
}

func (node *AragonClient) Start(network AragonNetwork, lidoApps string, deployedFile *deploy.DeployedFile) error {
	s, _ := pterm.DefaultSpinner.Start("Aragon client: starting...")

	defer s.Stop()

	if network == CMD_MAINNET {
		os.Setenv("RUN_CMD", "mainnet")
	}

	var appLocatorArr []string
	lidoAppsArray := strings.Split(lidoApps, ",")
	for _, app := range lidoAppsArray {
		tmp := strings.Split(app, ":")

		checkApp(tmp[0], tmp[1], deployedFile.AppLido, &appLocatorArr)

		if tmp[0] == deployedFile.AppLido.Name {
			if strings.HasPrefix(tmp[0], "0x") {
				appLocatorArr = append(appLocatorArr, fmt.Sprintf("%s:%s", tmp[0], tmp[1]))
			} else if deployedFile.AppLido.ID != "" {
				appLocatorArr = append(appLocatorArr, fmt.Sprintf("%s:%s", deployedFile.AppLido.ID, tmp[1]))
			}
		} else if tmp[0] == deployedFile.AppOracle.Name {
			if strings.HasPrefix(tmp[0], "0x") {
				appLocatorArr = append(appLocatorArr, fmt.Sprintf("%s:%s", tmp[0], tmp[1]))
			} else if deployedFile.AppOracle.ID != "" {
				appLocatorArr = append(appLocatorArr, fmt.Sprintf("%s:%s", deployedFile.AppOracle.ID, tmp[1]))
			}
		} else if tmp[0] == deployedFile.AppNodeOperatorsRegistry.Name {
			if strings.HasPrefix(tmp[0], "0x") {
				appLocatorArr = append(appLocatorArr, fmt.Sprintf("%s:%s", tmp[0], tmp[1]))
			} else if deployedFile.AppNodeOperatorsRegistry.ID != "" {
				appLocatorArr = append(appLocatorArr, fmt.Sprintf("%s:%s", deployedFile.AppNodeOperatorsRegistry.ID, tmp[1]))
			}
		}
	}

	if len(appLocatorArr) != 0 {
		os.Setenv("ARAGON_APP_LOCATOR", strings.Join(appLocatorArr, ","))
	}

	node.RunningUrl = ""
	node.Outb.Reset()
	node.Errb.Reset()

	node.Cmd = exec.Command("yarn", "aragon:start")
	node.Cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	node.Cmd.Stdout = &node.Outb
	node.Cmd.Stderr = &node.Errb
	err := node.Cmd.Start()
	if err != nil {
		return err
	}

	re, _ := regexp.Compile(`Server running at (.*?)\s`)

	timeout := 100
	for {
		if logs.Verbose {
			fmt.Print(node.Outb.String())
		}

		if strings.Contains(node.Outb.String(), "Built in") {
			s.Success()

			res := re.FindAllStringSubmatch(node.Outb.String(), -1)

			node.RunningUrl = string(res[0][1])

			// pterm.Info.Printf("Server running at %v\n", node.RunningUrl)

			return nil
		}

		if strings.Contains(node.Errb.String(), "Error:") {
			s.Fail()
			pterm.Error.Println(node.Errb.String())
			return errors.New(node.Errb.String())
		}
		node.Outb.Reset()
		time.Sleep(1 * time.Second)

		timeout--
		if timeout <= 0 {
			pterm.Print("timeout")
			s.Fail()

			node.Stop()
			break
		}
	}

	return nil
}

func (node *AragonClient) Stop() {
	if node.Cmd == nil {
		return
	}
	s, _ := pterm.DefaultSpinner.Start("Aragon client: Stopping...")
	syscall.Kill(-node.Cmd.Process.Pid, syscall.SIGKILL)
	node.Cmd.Process.Kill()
	node.Cmd = nil
	s.Success("Aragon client: Stopped")
}
