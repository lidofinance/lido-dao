package apps

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pterm/pterm"
)

type LidoAppsClient struct {
	Apps []*LidoApp
	Path string

	AppsLocator string
}

type LidoApp struct {
	Name       string
	Command    string
	Cmd        *exec.Cmd
	Outb       bytes.Buffer
	Errb       bytes.Buffer
	RunningUrl string
}

type Manifest struct {
	Name string `json:"name"`
}

func (node *LidoAppsClient) Start() error {
	pterm.Info.Println("Lido apps: checking apps...")

	apps := make([]*LidoApp, 0)

	files, err := ioutil.ReadDir(node.Path)
	if err != nil {
		return err
	}

	for _, f := range files {

		path := node.Path + "/" + f.Name()
		appPath := path + "/app/"
		maninfestPath := path + "/manifest.json"

		_, err := os.Stat(maninfestPath)
		if err != nil {
			pterm.Info.Printfln("Manifest %s doesn't exists, continue", maninfestPath)
			continue
		}

		jsonFile, err := os.Open(maninfestPath)
		if err != nil {
			return err
		}
		jsonResult, _ := ioutil.ReadAll(jsonFile)

		defer jsonFile.Close()

		var manifest Manifest
		json.Unmarshal(jsonResult, &manifest)

		apps = append(apps, &LidoApp{
			Name:    manifest.Name,
			Command: fmt.Sprintf("yarn --cwd %s dev", appPath),
		})

		pterm.Info.Printfln("Found app: %s", manifest.Name)
	}

	pterm.Info.Println("Try to start apps")

	var wg sync.WaitGroup

	node.Apps = apps

	for _, app := range node.Apps {

		app.RunningUrl = ""
		app.Outb.Reset()
		app.Errb.Reset()

		app.Cmd = exec.Command("/bin/sh", "-c", app.Command)
		app.Cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		app.Cmd.Stdout = &app.Outb
		app.Cmd.Stderr = &app.Errb
		err := app.Cmd.Start()
		if err != nil {
			return err
		}

		wg.Add(1)
		go node.CheckRunningUrl(&wg, app)
	}

	wg.Wait()

	return nil
}

func (node *LidoAppsClient) CheckRunningUrl(wg *sync.WaitGroup, app *LidoApp) error {
	defer wg.Done()

	pterm.Info.Println(app.Name + " starting...")

	re, _ := regexp.Compile(`Server running at (.*?)\s`)

	timeout := 60
	for {
		if strings.Contains(app.Outb.String(), "Built in") {

			res := re.FindAllStringSubmatch(app.Outb.String(), -1)

			app.RunningUrl = string(res[0][1])

			pterm.Success.Printf(app.Name+": running at %v\n", app.RunningUrl)

			return nil
		}

		if strings.Contains(app.Errb.String(), "Error:") {
			pterm.Error.Println(app.Errb.String())
			return errors.New(app.Errb.String())
		}
		time.Sleep(1 * time.Second)
		timeout--
		if timeout <= 0 {
			pterm.Print("timeout")

			app.Stop()
			break
		}
	}

	return nil
}

func (node *LidoAppsClient) Stop() {

	if len(node.Apps) == 0 {
		return
	}

	s, _ := pterm.DefaultSpinner.Start("Lido apps: Stopping...")
	for _, app := range node.Apps {
		app.Stop()
	}

	node.Apps = nil

	s.Success("Lido apps: Stopped")
}

func (app *LidoApp) Stop() {
	if app.Cmd == nil || app.Cmd.Process == nil {
		return
	}
	pterm.Info.Println(app.Name + ": Stopping...")
	syscall.Kill(-app.Cmd.Process.Pid, syscall.SIGKILL)
	app.Cmd.Process.Kill()
	app.Cmd = nil
	pterm.Info.Println(app.Name + ": Stopped")
}
